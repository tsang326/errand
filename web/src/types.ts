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

export type Health = {
  ok: boolean;
  products: 'channel3-live' | 'fixtures';
  searchMode: string;
  paypal: string;
  model: string;
  ai: { spentUsd: number; spendBudgetUsd: number; modelCalls: number };
};
