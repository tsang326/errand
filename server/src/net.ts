/**
 * Every outbound call gets a deadline. Without one, a stalled upstream (or a
 * free-plan instance being restarted mid-request) leaves the browser waiting
 * on a socket that never closes, and the page sits on "on it…" with nothing
 * said to the person. A deadline turns that into a message they can act on.
 */
export async function fetchWithDeadline(
  url: string,
  init: RequestInit,
  ms: number,
  what: string,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
  } catch (err) {
    const e = err as Error;
    // TimeoutError is what AbortSignal.timeout throws; AbortError covers the
    // older shape. Anything else is a network failure worth naming as one.
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw Object.assign(new Error(`${what} did not answer within ${Math.round(ms / 1000)}s`), {
        status: 504,
        code: 'upstream_timeout',
      });
    }
    throw Object.assign(new Error(`${what} is unreachable: ${e.message.slice(0, 200)}`), {
      status: 502,
      code: 'upstream_unreachable',
    });
  }
}

/** Deadlines in one place, so they can be read against each other. */
export const DEADLINE_MS = {
  /** Product search: one call, and the agentic mode is the slow part. */
  channel3: 25_000,
  /** Two model calls per errand; each must leave room for the other. */
  openai: 30_000,
  /** Token and order calls are small; PayPal is normally under a second. */
  paypal: 20_000,
} as const;
