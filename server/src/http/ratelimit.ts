/**
 * Fixed-window counters for the free path of the one route that spends money.
 *
 * `/api/errand` is unauthenticated and CORS is open, because the point is that
 * a visitor can type a sentence without an account. That also means a loop from
 * any browser tab spends about $0.033 of model credit and one Channel3 call per
 * iteration. Free errands are therefore counted per device and per address per
 * day, and against one hourly ceiling shared by everyone (config.ts, `limits`).
 * Paid errands are bounded by the runs on the pass instead.
 *
 * Deliberately in memory, like everything else in this server: a restart gives a
 * blocked caller a clean slate, which is the right failure direction for a demo a
 * visitor might reload. Money is bounded separately, by the daily ceiling in
 * ai/meter.ts.
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

/**
 * One verdict over several buckets at once, each with its own ceiling: room is
 * checked in every bucket before a hit is counted in any of them.
 *
 * Needed because a free errand is counted per device *and* per address, at
 * different ceilings — the address is shared by many people, the device is
 * not. Calling the single-bucket limiter twice would charge the first bucket
 * even when the second refuses, so a caller turned away on one count would
 * quietly burn the other.
 */
export type Bucket = { key: string; limit: number };

export function rateLimitBuckets(
  buckets: readonly Bucket[],
  windowMs: number,
  now = Date.now(),
): RateVerdict {
  let worst = 0;
  for (const { key, limit } of buckets) {
    const seen = hits.get(key);
    if (seen && seen.resetAt > now && seen.count >= limit) {
      worst = Math.max(worst, seen.resetAt - now);
    }
  }
  if (worst > 0) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(worst / 1000)) };

  for (const { key } of buckets) {
    const seen = hits.get(key);
    if (!seen || seen.resetAt <= now) hits.set(key, { count: 1, resetAt: now + windowMs });
    else seen.count += 1;
  }
  return { allowed: true };
}

/** The same over buckets that share one ceiling. */
export const rateLimitAll = (
  keys: readonly string[],
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateVerdict => rateLimitBuckets(keys.map((key) => ({ key, limit })), windowMs, now);

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
