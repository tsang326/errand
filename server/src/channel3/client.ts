import { config, channel3Live } from '../config.js';
import { nameSwatches } from './colours.js';
import type { Offer, Product, SearchResult } from './types.js';
import { fixtureSearch } from './fixtures.js';
import { DEADLINE_MS, fetchWithDeadline } from '../net.js';

type SearchOptions = {
  query: string;
  maxPrice?: number;
  limit?: number;
  /**
   * Channel3's `x-user-id`. It ties this search, the clicks that follow it and
   * the commission they earn to one shopper, which is the only way to tell
   * whose recommendation paid off. Letters, digits and `._@-`, up to 128.
   */
  userId?: string;
  /** Channel3's `page_token`, to read the page after the one it came from. */
  pageToken?: string;
};

/**
 * One call to Channel3's /search. Everything about shaping the request lives
 * here so the route and the agent never build a Channel3 payload themselves.
 *
 * With no API key this returns fixtures tagged `origin: 'fixture'`. The caller
 * is expected to pass that tag through to the UI: a grid of invented products
 * that looks identical to a grid of real ones is the one failure mode worth
 * engineering against here.
 */
export async function searchProducts(opts: SearchOptions): Promise<SearchResult> {
  const limit = opts.limit ?? config.channel3.limit;

  if (!channel3Live()) {
    return fixtureSearch(opts.query, limit, 'CHANNEL3_API_KEY is not set');
  }

  const body: Record<string, unknown> = {
    query: opts.query,
    config: { mode: config.channel3.mode },
    limit,
  };
  if (opts.pageToken) body.page_token = opts.pageToken;
  if (opts.maxPrice !== undefined) {
    body.filters = { price: { max_price: opts.maxPrice } };
  }

  const res = await fetchWithDeadline(
    `${config.channel3.baseUrl}/search`,
    {
      method: 'POST',
      headers: {
        'x-api-key': config.channel3.apiKey,
        'content-type': 'application/json',
        ...(opts.userId ? { 'x-user-id': opts.userId.slice(0, 128) } : {}),
      },
      body: JSON.stringify(body),
    },
    DEADLINE_MS.channel3,
    'Channel3',
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // A 429 carries Retry-After; surfacing it beats a blank grid, and the
    // hackathon key has a finite credit pool that a demo can exhaust.
    throw Object.assign(new Error(`channel3 ${res.status}: ${detail.slice(0, 300)}`), {
      status: res.status,
      retryAfter: res.headers.get('retry-after') ?? undefined,
    });
  }

  const json = (await res.json()) as { products?: unknown; next_page_token?: unknown };
  const token = typeof json.next_page_token === 'string' ? json.next_page_token : undefined;
  return {
    origin: 'live',
    query: opts.query,
    products: normalise(json.products),
    ...(token ? { nextPageToken: token } : {}),
  };
}

/**
 * Several pages of one search, merged.
 *
 * This is what a pass buys. A free errand reads one page, which is 24 products
 * out of an index of 25,000 — fine for "a desk lamp", thin for a sentence with
 * three requirements in it, where most of the first page can fail on the same
 * one. Paging widens the field the judge gets to rule on.
 *
 * Stops early on whatever Channel3 gives us: no page token means no more
 * pages, and a page that returns nothing new means the token is going in
 * circles. A failure on page two keeps page one rather than losing the search:
 * a narrower answer beats an error.
 */
export async function searchPages(
  opts: SearchOptions,
  pages: number,
  // Injectable so the paging rules (dedup, stop conditions, a failed page two)
  // can be tested without a Channel3 key.
  fetchPage: (o: SearchOptions) => Promise<SearchResult> = searchProducts,
): Promise<SearchResult> {
  const first = await fetchPage(opts);
  // One page is still a page read, and the page says so on screen: without
  // this a free errand showed no depth line at all.
  if (pages <= 1 || first.origin !== 'live') return { ...first, pagesRead: 1 };

  const seen = new Set(first.products.map((p) => p.id));
  const products = [...first.products];
  let token = first.nextPageToken;
  let read = 1;

  for (let page = 1; page < pages && token; page += 1) {
    let next: SearchResult;
    try {
      next = await fetchPage({ ...opts, pageToken: token });
    } catch {
      break;
    }
    const fresh = next.products.filter((p) => !seen.has(p.id));
    if (fresh.length === 0) break;
    for (const p of fresh) seen.add(p.id);
    products.push(...fresh);
    token = next.nextPageToken;
    read += 1;
  }

  return {
    ...first,
    products,
    pagesRead: read,
    ...(token ? { nextPageToken: token } : {}),
  };
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Maps the live response onto this app's own shape. Every field is optional on
 * the way in: Channel3 pins no version for callers, and a row that loses a
 * field should cost one empty cell rather than the whole search.
 */
export function normalise(raw: unknown): Product[] {
  const rows = Array.isArray(raw) ? raw : [];

  return rows.flatMap((row, i): Product[] => {
    if (typeof row !== 'object' || row === null) return [];
    const r = row as Record<string, unknown>;

    const brands = Array.isArray(r.brands) ? r.brands : [];
    const firstBrand = brands.find((b): b is Record<string, unknown> =>
      typeof b === 'object' && b !== null);

    const images = Array.isArray(r.images) ? r.images : [];
    const imgObjs = images.filter((im): im is Record<string, unknown> =>
      typeof im === 'object' && im !== null);
    // Prefer the image Channel3 marks as main; prefer its cleaned (background
    // removed) variant, which is the one that reads at grid row height.
    const img = imgObjs.find((im) => im.is_main_image === true) ?? imgObjs[0];

    const cat = typeof r.category === 'object' && r.category !== null
      ? (r.category as Record<string, unknown>)
      : {};
    const path = Array.isArray(cat.path) ? cat.path : [];

    const attrsRaw = typeof r.structured_attributes === 'object' && r.structured_attributes !== null
      ? (r.structured_attributes as Record<string, unknown>)
      : {};
    const attributes: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(attrsRaw)) {
      if (Array.isArray(v)) attributes[k] = v.map((x) => String(x));
    }

    const offers = (Array.isArray(r.offers) ? r.offers : []).flatMap((o): Offer[] => {
      if (typeof o !== 'object' || o === null) return [];
      const off = o as Record<string, unknown>;
      const priceObj = typeof off.price === 'object' && off.price !== null
        ? (off.price as Record<string, unknown>)
        : {};
      const price = num(priceObj.price) ?? num(off.price);
      if (price === undefined) return [];
      const compare = num(priceObj.compare_at_price);
      const commission = num(off.max_commission_rate);
      return [
        {
          url: str(off.url),
          domain: str(off.domain),
          price,
          ...(compare !== undefined && compare > price ? { compareAtPrice: compare } : {}),
          currency: str(priceObj.currency, 'USD'),
          // Anything other than an explicit InStock is treated as not buyable:
          // proposing a purchase the retailer cannot fulfil is worse than
          // dropping a row from the shortlist.
          inStock: off.availability === 'InStock',
          condition: str(off.condition, 'unknown'),
          ...(commission !== undefined && commission > 0 ? { commissionRate: commission } : {}),
        },
      ];
    });

    return [
      {
        id: str(r.id, `row-${i}`),
        title: str(r.title, 'Untitled'),
        description: str(r.description),
        brand: str(firstBrand?.name),
        imageUrl: str(img?.cleaned_url) || str(img?.url),
        imageAlt: str(img?.alt_text),
        category: str(cat.title),
        categoryPath: path.flatMap((p) =>
          typeof p === 'object' && p !== null ? [str((p as Record<string, unknown>).title)] : []),
        attributes,
        materials: Array.isArray(r.materials) ? r.materials.map((m) => String(m)) : [],
        colors: nameSwatches(r.colors),
        keyFeatures: Array.isArray(r.key_features) ? r.key_features.map((f) => String(f)) : [],
        variants: Array.isArray(r.variants) ? r.variants.map((v) => String(v)) : [],
        offers,
      },
    ];
  });
}

export type PricePoint = { date: string; price: number };

export type PriceCheck = {
  productId: string;
  /** What /search gave us, and what the cart is about to charge. */
  indexedPrice: number;
  /** The last point in Channel3's own price history for this product. */
  trackedPrice: number | null;
  trackedOn: string | null;
  /** The most recent move in that history, if there was one in the window. */
  lastChange: { from: number; to: number; date: string } | null;
  /**
   * True when the two Channel3 endpoints disagree about the same product by
   * more than a rounding cent. This is not a theoretical case: on 2026-11-04
   * /search offered The Azure Sea's Seven booster box at $120 from stockx.com
   * while /v0/price-tracking/history for the same id had moved to $304.17 on
   * 31 October. The $120 was four days stale and nothing in the search payload
   * said so.
   */
  disagrees: boolean;
};

/**
 * Channel3's price history for one product, used to audit the price /search
 * handed us. A separate endpoint family, deliberately: the point is to check
 * one source against another rather than to trust either.
 */
export async function priceHistory(productId: string, days = 90): Promise<PricePoint[]> {
  if (!channel3Live()) return [];
  const res = await fetchWithDeadline(
    `${config.channel3.historyUrl}/${encodeURIComponent(productId)}?days=${days}`,
    { headers: { 'x-api-key': config.channel3.apiKey } },
    DEADLINE_MS.channel3,
    'Channel3 price history',
  );
  // A product nobody tracks yet is a 404, which is an answer, not a failure:
  // no history simply means nothing to check the price against.
  if (res.status === 404) return [];
  if (!res.ok) {
    throw Object.assign(new Error(`channel3 history ${res.status}`), { status: res.status });
  }
  const json = (await res.json()) as { history?: unknown };
  if (!Array.isArray(json.history)) return [];
  return json.history.flatMap((p): PricePoint[] => {
    if (typeof p !== 'object' || p === null) return [];
    const o = p as Record<string, unknown>;
    const price = typeof o.price === 'number' ? o.price : Number(o.price);
    const ts = typeof o.timestamp === 'string' ? o.timestamp : '';
    if (!Number.isFinite(price) || !ts) return [];
    return [{ date: ts.slice(0, 10), price }];
  });
}

/**
 * The verdict itself, with no I/O, so the case that matters can be tested
 * against fixed points instead of against whatever Channel3 says today.
 */
export function verdictFrom(
  productId: string,
  indexedPrice: number,
  points: readonly PricePoint[],
): PriceCheck {
  const last = points[points.length - 1];
  let lastChange: PriceCheck['lastChange'] = null;
  for (let i = points.length - 1; i > 0; i -= 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (a.price !== b.price) {
      lastChange = { from: a.price, to: b.price, date: b.date };
      break;
    }
  }
  return {
    productId,
    indexedPrice,
    trackedPrice: last?.price ?? null,
    trackedOn: last?.date ?? null,
    lastChange,
    // A cent of float drift between two readings of the same price is not a
    // disagreement; anything a shopper would notice on a receipt is.
    disagrees: last !== undefined && Math.abs(last.price - indexedPrice) > 0.01,
  };
}

/** One product's indexed price, read against its own tracked history. */
export async function checkPrice(productId: string, indexedPrice: number): Promise<PriceCheck> {
  return verdictFrom(productId, indexedPrice, await priceHistory(productId));
}
