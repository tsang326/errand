import test from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit, rateLimitAll, rateLimitBuckets, resetRateLimits } from './ratelimit.js';

/**
 * The route this guards spends OpenAI credit and a Channel3 sponsor call on
 * every request, from a public URL with no login. The limiter is the only thing
 * between a loop in a browser tab and a drained key, so the three properties
 * below are the ones that matter: it lets a judge work, it stops a loop, and it
 * does not let one caller's loop lock out everyone else.
 */

test('a caller gets the whole allowance, then a 429 with a wait', () => {
  resetRateLimits();
  const now = 1_000_000;
  for (let i = 0; i < 6; i += 1) {
    assert.equal(rateLimit('a', 6, 3600_000, now).allowed, true, `call ${i + 1} should pass`);
  }
  const blocked = rateLimit('a', 6, 3600_000, now);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.allowed === false && blocked.retryAfterSeconds > 0);
  assert.ok(blocked.allowed === false && blocked.retryAfterSeconds <= 3600);
});

test('one caller burning the allowance does not block another', () => {
  resetRateLimits();
  const now = 1_000_000;
  for (let i = 0; i < 6; i += 1) rateLimit('loop', 6, 3600_000, now);
  assert.equal(rateLimit('loop', 6, 3600_000, now).allowed, false);
  assert.equal(rateLimit('judge', 6, 3600_000, now).allowed, true);
});

test('the window reopens, so a blocked caller is not blocked for ever', () => {
  resetRateLimits();
  const now = 1_000_000;
  for (let i = 0; i < 6; i += 1) rateLimit('a', 6, 1000, now);
  assert.equal(rateLimit('a', 6, 1000, now).allowed, false);
  assert.equal(rateLimit('a', 6, 1000, now + 1001).allowed, true);
});

/**
 * Keying on the wrong thing is how the first version of this failed in
 * production while passing every test: it counted Render's internal mesh
 * address, which rotates per request. These two pin the behaviour that matters
 * — a rotating key must not buy unlimited calls once the shared ceiling exists.
 */
test('a caller who rotates their key still meets the global ceiling', () => {
  resetRateLimits();
  const now = 1_000_000;
  let allowed = 0;
  for (let i = 0; i < 50; i += 1) {
    const perCaller = rateLimit(`rotating-${i}`, 6, 3600_000, now);
    const global = rateLimit('*all*', 40, 3600_000, now);
    if (perCaller.allowed && global.allowed) allowed += 1;
  }
  assert.equal(allowed, 40, 'the shared bucket, not the rotating one, is the wall');
});

test('the global ceiling leaves room for a normal day of judging', () => {
  resetRateLimits();
  const now = 1_000_000;
  // three judges, three runs each: nobody should be turned away
  for (const who of ['judge-a', 'judge-b', 'judge-c']) {
    for (let i = 0; i < 3; i += 1) {
      assert.equal(rateLimit(who, 6, 3600_000, now).allowed, true);
      assert.equal(rateLimit('*all*', 40, 3600_000, now).allowed, true);
    }
  }
});

/**
 * The free allowance is counted per address and per device, so the two-bucket
 * verdict has one rule worth pinning: a caller refused on one bucket must not
 * have been charged on the other.
 */
test('both buckets must have room, and a refusal charges neither', () => {
  resetRateLimits();
  const now = 1_000_000;
  // Spend the device's allowance through a different address.
  for (let i = 0; i < 2; i += 1) {
    assert.equal(rateLimitAll(['ip-a', 'dev:1'], 2, 60_000, now).allowed, true);
  }
  const refused = rateLimitAll(['ip-b', 'dev:1'], 2, 60_000, now);
  assert.equal(refused.allowed, false);
  // ip-b was never charged for the refused attempt: it still has both runs.
  assert.equal(rateLimitAll(['ip-b', 'dev:2'], 2, 60_000, now).allowed, true);
  assert.equal(rateLimitAll(['ip-b', 'dev:3'], 2, 60_000, now).allowed, true);
  assert.equal(rateLimitAll(['ip-b', 'dev:4'], 2, 60_000, now).allowed, false);
});

test('a new device behind a spent address is still refused', () => {
  resetRateLimits();
  const now = 2_000_000;
  for (let i = 0; i < 3; i += 1) {
    assert.equal(rateLimitAll(['ip-c', `dev:${i}`], 3, 60_000, now).allowed, true);
  }
  assert.equal(rateLimitAll(['ip-c', 'dev:new'], 3, 60_000, now).allowed, false);
});

test('the wait reported is the longer of the two windows', () => {
  resetRateLimits();
  const now = 3_000_000;
  assert.equal(rateLimitAll(['ip-d', 'dev:d'], 1, 10_000, now).allowed, true);
  const v = rateLimitAll(['ip-d', 'dev:d'], 1, 10_000, now + 1_000);
  assert.equal(v.allowed, false);
  if (!v.allowed) assert.equal(v.retryAfterSeconds, 9);
});

test('different ceilings per bucket: a device runs out before its address does', () => {
  resetRateLimits();
  const now = 4_000_000;
  const gate = (dev: string, at = now) =>
    rateLimitBuckets([{ key: `dev:${dev}`, limit: 2 }, { key: 'ip:x', limit: 6 }], 60_000, at);

  assert.equal(gate('a').allowed, true);
  assert.equal(gate('a').allowed, true);
  assert.equal(gate('a').allowed, false, 'the device is spent');
  // A second person behind the same address still gets their own allowance:
  // this is the case the single-ceiling version got wrong.
  assert.equal(gate('b').allowed, true);
  assert.equal(gate('b').allowed, true);
  assert.equal(gate('c').allowed, true);
  assert.equal(gate('c').allowed, true);
  assert.equal(gate('d').allowed, false, 'the address ceiling now holds');
});

test('a refusal on the address charges nothing to the fresh device', () => {
  resetRateLimits();
  const now = 5_000_000;
  const gate = (dev: string) =>
    rateLimitBuckets([{ key: `dev:${dev}`, limit: 5 }, { key: 'ip:y', limit: 1 }], 60_000, now);
  assert.equal(gate('p').allowed, true);
  assert.equal(gate('q').allowed, false);
  // q was never charged, so once the address frees up it has all five.
  const later = rateLimitBuckets(
    [{ key: 'dev:q', limit: 5 }, { key: 'ip:y', limit: 1 }],
    60_000,
    now + 61_000,
  );
  assert.equal(later.allowed, true);
});
