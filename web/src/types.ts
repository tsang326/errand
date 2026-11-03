export type Row = {
  productId: string;
  title: string;
  brand: string;
  imageUrl: string;
  category: string;
  categoryPath: string[];
  retailer: string;
  price: number | null;
  compareAtPrice: number | null;
  currency: string;
  inStock: boolean;
  offerCount: number;
  commissionRate: number;
  attributes: Record<string, string[]>;
  keyFeatures: string[];
  fit: number | null;
  why: string;
  misses: string[];
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
