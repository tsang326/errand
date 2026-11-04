import test from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit, resetRateLimits } from './ratelimit.js';

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
