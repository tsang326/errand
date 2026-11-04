import { config } from '../config.js';
import { assertBudget, record, type Usage } from './meter.js';
import { cheapestOffer, type Product } from '../channel3/types.js';
import { DEADLINE_MS, fetchWithDeadline } from '../net.js';

export type Plan = {
  /** What gets sent to Channel3 as the search query. */
  query: string;
  maxPrice?: number;
  /** Constraints the shopper stated that the ranking step must check. */
  requirements: string[];
  /** 'model' when a model wrote the plan, 'passthrough' when none was available. */
  source: 'model' | 'passthrough';
};

/** The agent's ruling on one requirement for one product. */
export type Mark = {
  /** Index into the plan's requirements, so the column is never guessed. */
  requirement: number;
  holds: 'yes' | 'no' | 'unclear';
  /** What the listing said, in the shopper's terms. Shown in the cell's tooltip. */
  note: string;
};

export type Verdict = {
  productId: string;
  /** One mark per requirement, in the plan's order. */
  marks: Mark[];
  /** One sentence, in the shopper's own terms, on why this row is here. */
  why: string;
};

/**
 * A single score is derived from the marks, never asked of the model
 * separately: a fact shown twice is one variable, so a row can never show
 * "92" beside three failed requirements. "Unclear" counts half because a
 * listing that is silent is not the same as one that contradicts you.
 */
export function fitOf(marks: readonly Mark[]): number | null {
  if (marks.length === 0) return null;
  const held = marks.reduce((n, m) => n + (m.holds === 'yes' ? 1 : m.holds === 'unclear' ? 0.5 : 0), 0);
  return Math.round((held / marks.length) * 100);
}

/** The notes of the requirements this row actually fails. */
export const missesOf = (marks: readonly Mark[]): string[] =>
  marks.filter((m) => m.holds === 'no').map((m) => m.note).filter((n) => n.length > 0);

export type Ranking = {
  verdicts: Verdict[];
  source: 'model' | 'passthrough';
  costUsd: number;
};

const SYSTEM_PLAN = `You turn one sentence of shopping intent into a product search.

Reply with JSON only: {"query": string, "max_price": number|null, "requirements": string[]}

- "query" is what a product search engine should receive: the thing being bought
  and the attributes that identify it. Drop politeness, budgets and deadlines.
- "max_price" is a per-item ceiling in the currency the shopper used, or null.
- "requirements" are the checkable constraints the shopper stated, one per
  string, in their own words. A delivery date or a recipient's age is a
  requirement even when a product search cannot filter on it.`;

const SYSTEM_RANK = `You judge each product against the shopper's own requirements, one at a time.

The requirements arrive as a numbered list. For every product reply with one entry:
{"product_id": string, "why": string,
 "marks": [{"requirement": <the number>, "holds": "yes"|"no"|"unclear", "note": string}]}

- Give one mark for EVERY requirement, in the order they were given. Never skip
  one and never invent a number that was not in the list.
- "yes" means the fields given show the requirement is met. "no" means they show
  it is not. "unclear" means the listing is silent: use it rather than guessing,
  and do not use it when the fields do answer the question.
- "note" is a short phrase in the shopper's terms saying what the listing said:
  "metal and glass, no plastic", "$53.99, under the $60 ceiling", "colour
  temperature not stated". Under 90 characters. Never a sales line.
- "why" is one sentence naming the concrete reason this product is on the list.
  If the only reason is that it matched the words, say that.
- Judge only from the fields given. Never invent a feature, a delivery date or a
  review.

Reply with JSON only: {"verdicts": [...]}`;

type ChatResponse = {
  choices?: { message?: { content?: string } }[];
  usage?: Usage;
};

async function chat(system: string, user: string): Promise<{ text: string; cost: number }> {
  assertBudget();
  const res = await fetchWithDeadline(
    'https://api.openai.com/v1/chat/completions',
    {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.openai.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.openai.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
    },
    DEADLINE_MS.openai,
    'OpenAI',
  );
  if (!res.ok) {
    throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as ChatResponse;
  // The usage block is read before anything else can throw: a call that
  // succeeded upstream has already cost money whether or not it parses here.
  const cost = record(config.openai.model, json.usage ?? {});
  return { text: json.choices?.[0]?.message?.content ?? '', cost };
}

const hasModel = (): boolean => config.openai.apiKey.length > 0;

/**
 * Turns the shopper's sentence into a Channel3 query. With no model configured
 * the sentence is passed through unchanged and labelled `passthrough`, which
 * searches worse but never silently pretends a plan was made.
 */
export async function planSearch(sentence: string): Promise<Plan> {
  if (!hasModel()) {
    return { query: sentence, requirements: [], source: 'passthrough' };
  }
  const { text } = await chat(SYSTEM_PLAN, sentence);
  let parsed: { query?: unknown; max_price?: unknown; requirements?: unknown } = {};
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    // A model that returns prose instead of JSON should degrade to the
    // shopper's own words, not to an empty search.
    return { query: sentence, requirements: [], source: 'passthrough' };
  }
  const max = Number(parsed.max_price);
  return {
    query: typeof parsed.query === 'string' && parsed.query.trim() ? parsed.query : sentence,
    ...(Number.isFinite(max) && max > 0 ? { maxPrice: max } : {}),
    requirements: Array.isArray(parsed.requirements)
      ? parsed.requirements.map(String).filter((r) => r.length > 0)
      : [],
    source: 'model',
  };
}

/** The product fields the ranking step is allowed to see, and nothing else. */
export function rankingInput(products: readonly Product[]): unknown[] {
  return products.map((p) => {
    const offer = cheapestOffer(p);
    return {
      product_id: p.id,
      title: p.title,
      brand: p.brand,
      category: p.categoryPath.join(' > ') || p.category,
      // The index's own prose about the product. Withholding it was how the
      // screen came to say "the listing does not say" about facts the index
      // did hold: the agent was ruling on a summary of a summary. Capped so
      // 24 of these still fit one request.
      description: p.description.slice(0, 400),
      materials: p.materials,
      attributes: p.attributes,
      key_features: p.keyFeatures.slice(0, 6),
      variants: p.variants,
      cheapest_offer: offer
        ? { price: offer.price, currency: offer.currency, retailer: offer.domain, in_stock: offer.inStock }
        : null,
      offer_count: p.offers.length,
    };
  });
}

/** One ranking call over at most `rankLimit` products. */
async function rankBatch(
  sentence: string,
  plan: Plan,
  batch: readonly Product[],
): Promise<{ verdicts: Verdict[]; costUsd: number }> {
  const { text, cost } = await chat(
    SYSTEM_RANK,
    JSON.stringify({
      request: sentence,
      // Numbered, because the marks come back keyed by this number.
      requirements: plan.requirements.map((text, i) => ({ number: i, text })),
      products: rankingInput(batch),
    }),
  );
  return { verdicts: parseVerdicts(text, batch, plan.requirements.length), costUsd: cost };
}

/**
 * Judges every product the search returned, in batches of `rankLimit`.
 *
 * A paid errand reads several pages of the index, which is more products than
 * belong in one prompt: a long prompt is where a model starts skipping rows,
 * and a skipped row shows an empty ledger on screen while still being counted.
 * So the field is split and the batches run together, and `rankMax` bounds how
 * many calls one sentence can ever cause.
 *
 * A batch that fails does not take the others down. Its rows come back unjudged
 * rather than wrong, which the grid already has a state for.
 */
export async function rankProducts(
  sentence: string,
  plan: Plan,
  products: readonly Product[],
): Promise<Ranking> {
  const subject = products.slice(0, config.ai.rankMax);
  if (!hasModel() || subject.length === 0) {
    return { verdicts: [], source: 'passthrough', costUsd: 0 };
  }
  const size = Math.max(1, config.ai.rankLimit);
  const batches: Product[][] = [];
  for (let i = 0; i < subject.length; i += size) batches.push(subject.slice(i, i + size));

  const results = await Promise.allSettled(
    batches.map((batch) => rankBatch(sentence, plan, batch)),
  );

  const verdicts: Verdict[] = [];
  let costUsd = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') {
      verdicts.push(...r.value.verdicts);
      costUsd += r.value.costUsd;
    } else {
      failed += 1;
    }
  }
  // Every batch failing is the same thing as having no model: say so rather
  // than reporting a model answer that is entirely empty.
  if (failed === batches.length) {
    const first = results[0];
    if (first && first.status === 'rejected') throw first.reason;
  }
  return { verdicts, source: 'model', costUsd };
}

/**
 * Keeps only verdicts about products that were actually sent. A model that
 * invents a product id must not be able to add a row to the grid.
 */
export function parseVerdicts(
  text: string,
  products: readonly Product[],
  requirementCount: number,
): Verdict[] {
  const known = new Set(products.map((p) => p.id));
  let rows: unknown[] = [];
  try {
    const parsed = JSON.parse(text) as { verdicts?: unknown };
    rows = Array.isArray(parsed.verdicts) ? parsed.verdicts : [];
  } catch {
    return [];
  }
  return rows.flatMap((r): Verdict[] => {
    if (typeof r !== 'object' || r === null) return [];
    const v = r as Record<string, unknown>;
    const id = String(v.product_id ?? '');
    if (!known.has(id)) return [];
    return [
      {
        productId: id,
        marks: parseMarks(v.marks, requirementCount),
        why: typeof v.why === 'string' ? v.why : '',
      },
    ];
  });
}

/**
 * One mark per requirement, in requirement order, whatever the model returned.
 * A requirement the model skipped comes back as "unclear" rather than being
 * dropped: a missing column would silently shorten the ledger, and a buyer
 * reading four columns must get four answers.
 */
function parseMarks(raw: unknown, count: number): Mark[] {
  const byIndex = new Map<number, Mark>();
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) continue;
      const m = entry as Record<string, unknown>;
      const i = Number(m.requirement);
      if (!Number.isInteger(i) || i < 0 || i >= count || byIndex.has(i)) continue;
      const holds = m.holds === 'yes' || m.holds === 'no' ? m.holds : 'unclear';
      byIndex.set(i, {
        requirement: i,
        holds,
        note: typeof m.note === 'string' ? m.note.slice(0, 120) : '',
      });
    }
  }
  return Array.from({ length: count }, (_, i) =>
    byIndex.get(i) ?? { requirement: i, holds: 'unclear' as const, note: 'the agent did not say' },
  );
}
