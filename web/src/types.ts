export type PriceCheck = {
  productId: string;
  /** The price the row was shown at, which is what the cart would charge. */
  indexedPrice: number;
  /** The last point in Channel3's own price-tracking history for this product. */
  trackedPrice: number | null;
  trackedOn: string | null;
  lastChange: { from: number; to: number; date: string } | null;
  /** The two Channel3 endpoints disagree about this product's price. */
  disagrees: boolean;
};

export type RowOffer = {
  retailer: string;
  url: string;
  price: number;
  currency: string;
  inStock: boolean;
};

export type Row = {
  productId: string;
  title: string;
  brand: string;
  imageUrl: string;
  category: string;
  categoryPath: string[];
  retailer: string;
  /** The retailer's own page for this offer. Empty when the offer has none. */
  url: string;
  price: number | null;
  compareAtPrice: number | null;
  currency: string;
  inStock: boolean;
  offerCount: number;
  /** Every offer the index holds, cheapest first. See RowOffer on the server. */
  offers: RowOffer[];
  commissionRate: number;
  attributes: Record<string, string[]>;
  keyFeatures: string[];
  /** One mark per requirement, in the plan's order. Empty if never judged. */
  marks: Mark[];
  /** Derived from the marks on the server; shown, never recomputed here. */
  fit: number | null;
  why: string;
  misses: string[];
};

/** The agent's ruling on one of the shopper's requirements. */
export type Mark = {
  requirement: number;
  holds: 'yes' | 'no' | 'unclear';
  note: string;
};

export type Plan = {
  query: string;
  maxPrice?: number;
  requirements: string[];
  source: 'model' | 'passthrough';
};

export type Errand = {
  id: string;
  sentence: string;
  plan: Plan;
  origin: 'live' | 'fixture';
  note?: string;
  rows: Row[];
  createdAt: string;
  /** Absent on an errand stored by a build older than the one that saved it. */
  ranking?: { source: 'model' | 'passthrough'; costUsd: number };
};

export type CreatedOrder = {
  id: string;
  status: string;
  approveUrl?: string;
  total: string;
  currency: string;
};

/**
 * What PayPal recorded when the money actually moved. The order the app creates
 * is only an intent: until this comes back with a capture id, nothing has been
 * paid, and a screen that stops at the approval page cannot tell the two apart.
 */
export type CapturedOrder = {
  id: string;
  status: string;
  captureId?: string;
  amount?: string;
  currency?: string;
  payer?: string;
};

export type Health = {
  ok: boolean;
  products: 'channel3-live' | 'fixtures';
  searchMode: string;
  paypal: string;
  model: string;
  ai: { spentUsd: number; spendBudgetUsd: number; modelCalls: number };
};
