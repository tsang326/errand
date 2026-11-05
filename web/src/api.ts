import type {
  CapturedOrder,
  CreatedOrder,
  Errand,
  Health,
  Pass,
  PassStatus,
  PriceCheck,
  Row,
} from './types';

/**
 * The deployment sleeps after 15 minutes idle and takes about a minute to come
 * back, so the first call of a visit is genuinely slow. It is still bounded:
 * a request with no deadline leaves the button on "on it…" for ever if the
 * instance is restarted mid-flight, which is the one failure nobody can act on.
 */
// 90 s was not enough for the worst honest case: a cold start measured at ~53 s,
// then a Channel3 call (25 s deadline) and two model calls (30 s each). The
// client was giving up on a request the server was still legitimately serving.
const DEADLINE_MS = 150_000;

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
        'the agent did not answer within 150 seconds. This demo sleeps when idle, so try once more.',
      );
    }
    throw new Error(`could not reach the agent: ${e.message}`);
  }
  const json = (await res.json()) as T & { error?: string; detail?: string };
  // `detail` is the sentence written for a person; `error` is the machine code.
  // Showing "rate_limited" to a visitor explains nothing.
  if (!res.ok) throw new Error(json.detail ?? json.error ?? `${path} failed (${res.status})`);
  return json;
}

export const runErrand = (sentence: string, pass?: string): Promise<Errand> =>
  post<Errand>('/api/errand', { sentence, ...(pass ? { pass } : {}) });

/**
 * Buys a pass. No price crosses the wire: what a pass costs and how many
 * errands it holds are the server's to decide, because the pass is Errand's own
 * product rather than a cart a browser priced.
 */
export const buyPass = (): Promise<CreatedOrder> =>
  post<CreatedOrder>('/api/pass/order', {
    returnUrl: `${window.location.origin}/paid`,
    cancelUrl: `${window.location.origin}/cancelled`,
  });

/** Takes the money for an approved pass; only after this is there a pass. */
export const capturePass = (orderId: string): Promise<{ captured: CapturedOrder | null; pass: Pass }> =>
  post(`/api/pass/${encodeURIComponent(orderId)}/capture`, {});

/** What is left on a pass, restored from PayPal if this instance has restarted. */
export const readPass = async (orderId: string): Promise<Pass | undefined> => {
  const res = await fetch(`/api/pass/${encodeURIComponent(orderId)}`);
  if (!res.ok) return undefined;
  return ((await res.json()) as { pass: Pass }).pass;
};

/** Asks PayPal, not this server, what became of the payment. */
export const passStatus = async (orderId: string): Promise<PassStatus> => {
  const res = await fetch(`/api/pass/${encodeURIComponent(orderId)}/status`);
  if (!res.ok) throw new Error(`PayPal would not answer (${res.status})`);
  return (await res.json()) as PassStatus;
};

/** Hands back the runs the shopper did not use. */
export const refundPass = (orderId: string): Promise<{ refund: { amount?: string; currency?: string; status: string }; pass: Pass }> =>
  post(`/api/pass/${encodeURIComponent(orderId)}/refund`, {});

export const getHealth = async (): Promise<Health> => {
  const res = await fetch('/api/health');
  if (!res.ok) throw new Error(`health ${res.status}`);
  return (await res.json()) as Health;
};

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

/**
 * Re-reads the ticked rows against Channel3's price-tracking history before
 * anything is proposed to PayPal. It is a second opinion on the same index,
 * not a second index: when the two disagree, that is the fact worth showing.
 */
export const checkPrices = (rows: { row: Row; quantity: number }[]): Promise<{ checks: PriceCheck[]; tracked: number }> =>
  post('/api/price-check', {
    lines: rows.map(({ row }) => ({ productId: row.productId, price: row.price ?? 0 })),
  });
