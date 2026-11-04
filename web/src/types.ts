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
  /** Present when this errand was paid for: the pass, one run lighter. */
  pass?: Pass;
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

/**
 * What PayPal itself says about a payment, read back from PayPal on demand.
 * The app's own numbers are easy to print; this is the version a judge can
 * check against the PayPal dashboard, which is why it is on screen at all.
 */
export type PassStatus = {
  paypal: {
    id: string;
    status: string;
    invoiceId?: string;
    captureId?: string;
    captureStatus?: string;
    amount?: string;
    currency?: string;
  };
  pass?: Pass;
};

export type Health = {
  ok: boolean;
  products: 'channel3-live' | 'fixtures';
  searchMode: string;
  paypal: string;
  model: string;
  ai: { spentUsd: number; spendBudgetUsd: number; modelCalls: number };
  pass?: { runs: number; price: string; currency: string; held: number };
  webhooks?: { configured: boolean; seen: { at: string; type: string; orderId?: string; action: string }[] };
  rate?: { perHour: number; freeRunsPerHour: number; globalPerHour: number };
};

/**
 * A pass: errands bought up front and spent one at a time. The money is for the
 * agent's work, which is the only thing in this app that Errand itself makes
 * and delivers — the goods belong to the retailer, who sells them.
 */
export type Pass = {
  orderId: string;
  runs: number;
  used: number;
  left: number;
  amount: string;
  currency: string;
  captureId?: string;
  refundedAt?: string;
};
