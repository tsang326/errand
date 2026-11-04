/**
 * A per-IP ceiling on the one route that spends money.
 *
 * `/api/errand` is unauthenticated and CORS is open, because the whole point is
 * that a judge can type a sentence without an account. That also means a loop
 * from any browser tab spends ~$0.033 of OpenAI credit and one Channel3 call per
 * iteration, on keys shared with three other live entries — and keeping the
 * instance awake burns the account's free Render hours, which Interlock is also
 * drawing from. The in-process spend meter does not stop that: Render's free plan
 * sleeps after 15 minutes idle, so every cold start hands the caller a fresh
 * budget. This does stop it, in the only place the cost is actually incurred.
 *
 * Deliberately in memory, like everything else in this server: a restart gives a
 * blocked caller a clean slate, which is the right failure direction for a demo a
 * judge might reload. The expensive thing a restart resets is the *spend* ceiling,
 * and that is set at the OpenAI project level instead, where it survives.
 */

type Window = { count: number; resetAt: number };

const hits = new Map<string, Window>();

export type RateVerdict = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateVerdict {
  // Sweep here rather than on a timer: the map only grows while requests arrive,
  // and a timer would keep a sleeping free instance from sleeping.
  if (hits.size > 5000) {
    for (const [k, w] of hits) if (w.resetAt <= now) hits.delete(k);
  }

  const seen = hits.get(key);
  if (!seen || seen.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (seen.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((seen.resetAt - now) / 1000)) };
  }

  seen.count += 1;
  return { allowed: true };
}

/** Exposed for tests; also the thing to call if a route ever needs a reset. */
export function resetRateLimits(): void {
  hits.clear();
}

/**
 * What the limiter currently holds, for /api/health. A guard whose state cannot
 * be read is a guard you believe in rather than one you have checked: this one
 * was in the deployed commit and silently not counting, and nothing on the
 * instance could say so.
 */
export function rateLimitState(): { callers: number; busiest: number } {
  let busiest = 0;
  for (const w of hits.values()) if (w.count > busiest) busiest = w.count;
  return { callers: hits.size, busiest };
}
