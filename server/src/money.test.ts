import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCents, centsToString, sumCents, lineTotal } from './money.js';

test('a cart that drifts in floats is exact in cents', () => {
  // Three of the $34.12 dinosaur egg sets, a real price from the Channel3
  // response recorded in src/fixtures: in floating point that is
  // 102.35999999999999, and PayPal rejects an order whose item breakdown does
  // not sum to the total to the cent.
  const floats = 34.12 + 34.12 + 34.12;
  assert.equal(floats, 102.35999999999999);
  assert.notEqual(String(floats), floats.toFixed(2));

  const cents = sumCents([34.12, 34.12, 34.12].map(toCents));
  assert.equal(cents, 10236);
  assert.equal(centsToString(cents), '102.36');
});

test('a price with more than two decimals is rounded once, at the edge', () => {
  assert.equal(toCents(0.125), 13);
  assert.equal(centsToString(toCents(129.999)), '130.00');
});

test('quantity multiplies before any formatting', () => {
  assert.equal(centsToString(lineTotal(toCents(34.12), 3)), '102.36');
});

test('PayPal always gets two decimal places', () => {
  assert.equal(centsToString(toCents(40)), '40.00');
  assert.equal(centsToString(0), '0.00');
});
