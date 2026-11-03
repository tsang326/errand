import type { CreatedOrder, Errand, Health, Row } from './types';

/**
 * The deployment sleeps after 15 minutes idle and takes about a minute to come
 * back, so the first call of a visit is genuinely slow. It is still bounded:
 * a request with no deadline leaves the button on "on it…" for ever if the
 * instance is restarted mid-flight, which is the one failure nobody can act on.
 */
const DEADLINE_MS = 90_000;

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(DEADLINE_MS),
    });
  } catch (err) {
    const e = err as Error;
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw new Error(
        'the agent did not answer within 90 seconds. This demo sleeps when idle, so try once more.',
      );
    }
    throw new Error(`could not reach the agent: ${e.message}`);
  }
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
  // Errands live in the server's memory, so a restart (or the free instance
  // going to sleep) loses the link. Say that, and say what to do about it.
  if (!res.ok)
    throw new Error(
      `That errand is gone (${res.status}). Results are kept in memory, so a restart clears them. Send the sentence again to get a fresh shortlist.`,
    );
  return (await res.json()) as Errand;
};
