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

export type Verdict = {
  productId: string;
  /** 0-100. The agent's own confidence that this row answers the request. */
  fit: number;
  /** One sentence, in the shopper's own terms, on why this row is here. */
  why: string;
  /** Requirements this row fails or cannot be shown to meet. Often empty. */
  misses: string[];
};

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

const SYSTEM_RANK = `You are explaining a shortlist to the person who asked for it.

For each product you are given, reply with one entry:
{"product_id": string, "fit": 0-100, "why": string, "misses": string[]}

- "why" is one sentence naming the concrete reason this product answers the
  request. No sales language. If the only reason is that it matched the words,
  say that.
- "misses" lists the stated requirements this product fails, or that the data
  cannot show either way. An empty list is a claim that every requirement is
  met, so do not leave it empty out of politeness.
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

export async function rankProducts(
  sentence: string,
  plan: Plan,
  products: readonly Product[],
): Promise<Ranking> {
  const subject = products.slice(0, config.ai.rankLimit);
  if (!hasModel() || subject.length === 0) {
    return { verdicts: [], source: 'passthrough', costUsd: 0 };
  }
  const { text, cost } = await chat(
    SYSTEM_RANK,
    JSON.stringify({
      request: sentence,
      requirements: plan.requirements,
      products: rankingInput(subject),
    }),
  );
  return { verdicts: parseVerdicts(text, subject), source: 'model', costUsd: cost };
}

/**
 * Keeps only verdicts about products that were actually sent. A model that
 * invents a product id must not be able to add a row to the grid.
 */
export function parseVerdicts(text: string, products: readonly Product[]): Verdict[] {
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
    const fit = Number(v.fit);
    return [
      {
        productId: id,
        fit: Number.isFinite(fit) ? Math.min(100, Math.max(0, Math.round(fit))) : 0,
        why: typeof v.why === 'string' ? v.why : '',
        misses: Array.isArray(v.misses) ? v.misses.map(String).filter((m) => m.length > 0) : [],
      },
    ];
  });
}
