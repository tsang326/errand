import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSearch, rankProducts, parseVerdicts, rankingInput, fitOf } from './shopper.js';
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
      { product_id: products[0]!.id, why: 'ok', marks: [{ requirement: 0, holds: 'yes', note: 'a' }] },
      { product_id: 'invented-by-the-model', why: 'perfect', marks: [] },
    ],
  });
  const v = parseVerdicts(text, products, 1);
  assert.equal(v.length, 1);
  assert.equal(v[0]!.productId, products[0]!.id);
});

test('every requirement gets a mark, even the ones the model skipped', () => {
  const text = JSON.stringify({
    verdicts: [
      {
        product_id: products[0]!.id,
        why: 'answered only the first',
        marks: [{ requirement: 0, holds: 'yes', note: 'under $40' }],
      },
    ],
  });
  const v = parseVerdicts(text, products, 3);
  assert.equal(v[0]!.marks.length, 3, 'the ledger keeps a column for every requirement');
  assert.equal(v[0]!.marks[0]!.holds, 'yes');
  // A skipped requirement is unanswered, which is not the same as failed.
  assert.equal(v[0]!.marks[1]!.holds, 'unclear');
  assert.equal(v[0]!.marks[2]!.holds, 'unclear');
});

test('a mark for a requirement that does not exist is discarded', () => {
  const text = JSON.stringify({
    verdicts: [
      {
        product_id: products[0]!.id,
        why: '',
        marks: [
          { requirement: 7, holds: 'no', note: 'invented column' },
          { requirement: 0, holds: 'no', note: 'over budget' },
        ],
      },
    ],
  });
  const v = parseVerdicts(text, products, 2);
  assert.equal(v[0]!.marks.length, 2);
  assert.equal(v[0]!.marks[0]!.note, 'over budget');
});

test('fit is derived from the marks, so it can never disagree with them', () => {
  const mark = (requirement: number, holds: 'yes' | 'no' | 'unclear') => ({
    requirement,
    holds,
    note: '',
  });
  assert.equal(fitOf([]), null, 'no requirements means no score, not a zero');
  assert.equal(fitOf([mark(0, 'yes'), mark(1, 'yes')]), 100);
  assert.equal(fitOf([mark(0, 'no'), mark(1, 'no')]), 0);
  // A silent listing is not a contradicted one: it counts half.
  assert.equal(fitOf([mark(0, 'yes'), mark(1, 'unclear')]), 75);
  assert.equal(fitOf([mark(0, 'yes'), mark(1, 'no')]), 50);
});

test('prose instead of JSON yields no verdicts, not a crash', () => {
  assert.deepEqual(parseVerdicts('Sure! Here are my thoughts:', products, 2), []);
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
