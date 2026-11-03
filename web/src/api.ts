import type { CreatedOrder, Errand, Health, Row } from './types';

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `${path} failed (${res.status})`);
  return json;
}

export const runErrand = (sentence: string): Promise<Errand> =>
  post<Errand>('/api/errand', { sentence });

export const getHealth = async (): Promise<Health> => {
  const res = await fetch('/api/health');
  if (!res.ok) throw new Error(`health ${res.status}`);
  return (await res.json()) as Health;
};

/** Cart lines are built from grid rows, so the price PayPal sees is the price shown. */
export const createOrder = (rows: { row: Row; quantity: number }[]): Promise<CreatedOrder> =>
  post<CreatedOrder>('/api/order', {
    lines: rows.map(({ row, quantity }) => ({
      productId: row.productId,
      title: row.title,
      merchant: row.retailer,
      unitPrice: row.price ?? 0,
      quantity,
      currency: row.currency,
    })),
    returnUrl: `${window.location.origin}/paid`,
    cancelUrl: `${window.location.origin}/cancelled`,
  });

/**
 * Reopens an errand the server still holds. The id lives in the URL hash, so a
 * shortlist can be linked to and reloaded without re-running the search — which
 * also means no second charge against the Channel3 credits or the model budget.
 */
export const getErrand = async (id: string): Promise<Errand> => {
  const res = await fetch(`/api/errand/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`that errand is no longer held (${res.status})`);
  return (await res.json()) as Errand;
};
