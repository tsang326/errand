import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSearch, rankProducts, parseVerdicts, rankingInput } from './shopper.js';
import { costOf, record, resetMeter, meterState, budgetLeft, assertBudget } from './meter.js';
import { fixtureSearch } from '../channel3/fixtures.js';

const products = fixtureSearch('dinosaur', 24, 'test').products;

/** The suite runs with OPENAI_API_KEY empty (see package.json). */
test('with no model, the plan is the shopper sentence, labelled passthrough', async () => {
  const p = await planSearch('gift for a six year old who likes dinosaurs, under $40');
  assert.equal(p.source, 'passthrough');
  assert.equal(p.query, 'gift for a six year old who likes dinosaurs, under $40');
  assert.deepEqual(p.requirements, []);
});

test('with no model, ranking returns nothing rather than inventing verdicts', async () => {
  const r = await rankProducts('anything', { query: 'x', requirements: [], source: 'passthrough' }, products);
  assert.equal(r.source, 'passthrough');
  assert.deepEqual(r.verdicts, []);
  assert.equal(r.costUsd, 0);
});

test('a verdict about a product that was never sent is dropped', () => {
  const text = JSON.stringify({
    verdicts: [
      { product_id: products[0]!.id, fit: 80, why: 'ok', misses: [] },
      { product_id: 'invented-by-the-model', fit: 99, why: 'perfect', misses: [] },
    ],
  });
  const v = parseVerdicts(text, products);
  assert.equal(v.length, 1);
  assert.equal(v[0]!.productId, products[0]!.id);
});

test('fit is clamped to 0-100 and a missing fit is not treated as a high score', () => {
  const text = JSON.stringify({
    verdicts: [
      { product_id: products[0]!.id, fit: 1000, why: '', misses: [] },
      { product_id: products[1]!.id, why: 'no fit field', misses: [] },
    ],
  });
  const v = parseVerdicts(text, products);
  assert.equal(v[0]!.fit, 100);
  assert.equal(v[1]!.fit, 0);
});

test('prose instead of JSON yields no verdicts, not a crash', () => {
  assert.deepEqual(parseVerdicts('Sure! Here are my thoughts:', products), []);
});

test('the ranking step is shown offers and attributes, never a buy link', () => {
  const input = JSON.stringify(rankingInput(products));
  assert.match(input, /cheapest_offer/);
  assert.doesNotMatch(input, /buy\.trychannel3|http/);
});

test('an unlisted model is metered at the dearest known rate, not at zero', () => {
  const known = costOf('gpt-4.1', { prompt_tokens: 1_000_000, completion_tokens: 0 });
  const unknown = costOf('some-new-model', { prompt_tokens: 1_000_000, completion_tokens: 0 });
  assert.equal(known, 2);
  assert.equal(unknown, 2);
});

test('the spend ceiling blocks further calls and does not refill', () => {
  resetMeter();
  assert.doesNotThrow(assertBudget);
  record('gpt-4.1', { prompt_tokens: 10_000_000, completion_tokens: 0 });
  assert.ok(budgetLeft() < 0);
  assert.throws(assertBudget, /budget for this deployment is spent/);
  assert.equal(meterState().modelCalls, 1);
  resetMeter();
});
