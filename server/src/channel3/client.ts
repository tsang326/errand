import { config, channel3Live } from '../config.js';
import type { Product, SearchResult } from './types.js';
import { fixtureSearch } from './fixtures.js';

type SearchOptions = { query: string; maxPrice?: number; limit?: number };

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
  if (opts.maxPrice !== undefined) {
    body.filters = { price: { max_price: opts.maxPrice } };
  }

  const res = await fetch(`${config.channel3.baseUrl}/search`, {
    method: 'POST',
    headers: {
      'x-api-key': config.channel3.apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // A 429 carries Retry-After; surfacing it beats a blank grid, and the
    // hackathon key has a finite credit pool that a demo can exhaust.
    throw Object.assign(new Error(`channel3 ${res.status}: ${detail.slice(0, 300)}`), {
      status: res.status,
      retryAfter: res.headers.get('retry-after') ?? undefined,
    });
  }

  const json = (await res.json()) as unknown;
  return {
    origin: 'live',
    query: opts.query,
    products: normalise(json),
  };
}

/**
 * Channel3's response is read defensively: this app pins no version of their
 * schema, so a field that moves should cost one empty column, not a 500.
 */
function normalise(json: unknown): Product[] {
  const rows = Array.isArray(json)
    ? json
    : Array.isArray((json as { products?: unknown })?.products)
      ? ((json as { products: unknown[] }).products)
      : Array.isArray((json as { data?: unknown })?.data)
        ? ((json as { data: unknown[] }).data)
        : [];

  return rows.flatMap((raw, i): Product[] => {
    if (typeof raw !== 'object' || raw === null) return [];
    const r = raw as Record<string, unknown>;
    const offers = Array.isArray(r.offers) ? r.offers : [];
    return [
      {
        id: String(r.id ?? r.product_id ?? `row-${i}`),
        title: String(r.title ?? r.name ?? 'Untitled'),
        brand: String(r.brand ?? r.brand_name ?? ''),
        imageUrl: String(r.image_url ?? r.image ?? ''),
        variants: Array.isArray(r.variants) ? r.variants.map(String) : [],
        offers: offers.flatMap((o) => {
          if (typeof o !== 'object' || o === null) return [];
          const off = o as Record<string, unknown>;
          const price = Number(off.price ?? off.offer_price ?? NaN);
          if (!Number.isFinite(price)) return [];
          return [
            {
              merchant: String(off.merchant ?? off.merchant_name ?? off.website ?? ''),
              price,
              currency: String(off.currency ?? 'USD'),
              url: String(off.url ?? off.buy_link ?? ''),
              inStock: off.availability === undefined ? true : off.availability === 'InStock',
              ...(Number.isFinite(Number(off.commission_rate))
                ? { commissionRate: Number(off.commission_rate) }
                : {}),
            },
          ];
        }),
      },
    ];
  });
}
