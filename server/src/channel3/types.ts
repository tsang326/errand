/**
 * Channel3's product shape as the live API actually returns it, verified
 * against a real POST /v1/search response on 2026-11-03 rather than against
 * the docs' prose. The differences mattered: brands and images are arrays, the
 * price sits two levels down inside an offer, and `variants`, `age`, `gender`
 * and `ratings` all come back null on plenty of rows.
 */
export type Offer = {
  /** Channel3's monetizable buy link, already carrying the account id. */
  url: string;
  /** The retailer, as a domain: 'kohls.com'. There is no display name. */
  domain: string;
  price: number;
  /** List price when the offer is a markdown, else undefined. */
  compareAtPrice?: number;
  currency: string;
  inStock: boolean;
  condition: string;
  /** 0.021 means 2.1%. Absent on offers that pay nothing. */
  commissionRate?: number;
};

export type Product = {
  id: string;
  title: string;
  description: string;
  brand: string;
  imageUrl: string;
  imageAlt: string;
  /** Leaf category, e.g. 'Animal Figures'. */
  category: string;
  /** Full path, broad to narrow: ['Toys & Games', …, 'Animal Figures']. */
  categoryPath: string[];
  /** Channel3's own extracted attributes, e.g. 'recommended-age-group'. */
  attributes: Record<string, string[]>;
  keyFeatures: string[];
  variants: string[];
  offers: Offer[];
};

/** Which search path produced a result set. `fixture` never means live data. */
export type ResultOrigin = 'live' | 'fixture';

export type SearchResult = {
  origin: ResultOrigin;
  /** The sentence the shopper typed, unmodified. */
  query: string;
  products: Product[];
  /** Channel3's cursor, when there are further pages. */
  nextPageToken?: string;
  /** Why a fixture answer was given, when it was. */
  note?: string;
};

export const cheapestOffer = (p: Product): Offer | undefined =>
  p.offers.filter((o) => o.inStock).sort((a, b) => a.price - b.price)[0] ?? p.offers[0];

/** Best commission on offer, as a fraction. Used to show what the app earns. */
export const bestCommission = (p: Product): number =>
  p.offers.reduce((best, o) => Math.max(best, o.commissionRate ?? 0), 0);
