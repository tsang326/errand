/**
 * The subset of Channel3's product shape this app relies on, plus where the row
 * came from. Written against the published request/response docs
 * (channel3.ai/docs, POST /v1/search with x-api-key); fields the docs show but
 * this app does not read are deliberately absent rather than guessed at.
 */
export type Offer = {
  merchant: string;
  price: number;
  currency: string;
  url: string;
  inStock: boolean;
  commissionRate?: number;
};

export type Product = {
  id: string;
  title: string;
  brand: string;
  imageUrl: string;
  variants: string[];
  offers: Offer[];
};

/** Which search path produced a result set. `fixture` never means live data. */
export type ResultOrigin = 'live' | 'fixture';

export type SearchResult = {
  origin: ResultOrigin;
  /** The sentence the shopper typed, unmodified. */
  query: string;
  /** Present only when the live API ran; what Channel3 charged the account. */
  creditsUsed?: number;
  products: Product[];
  /** Why a fixture answer was given, when it was. */
  note?: string;
};

export const cheapestOffer = (p: Product): Offer | undefined =>
  p.offers.filter((o) => o.inStock).sort((a, b) => a.price - b.price)[0] ?? p.offers[0];
