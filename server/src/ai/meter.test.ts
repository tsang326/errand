import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBudget, budgetLeft, record, resetMeter } from './meter.js';
import { config } from '../config.js';

const day1 = Date.parse('2026-12-03T10:00:00Z');
const laterDay1 = Date.parse('2026-12-03T23:59:00Z');
const day2 = Date.parse('2026-12-04T00:01:00Z');

// 1M prompt tokens of gpt-4.1 is $2.00; enough to spend a $3.00 day in two calls.
const big = { prompt_tokens: 1_000_000, completion_tokens: 0 };

test('the ceiling holds for the rest of the day once it is spent', () => {
  resetMeter();
  record('gpt-4.1', big, day1);
  record('gpt-4.1', big, day1);
  assert.ok(budgetLeft(laterDay1) <= 0);
  assert.throws(() => assertBudget(laterDay1), /resets at 00:00 UTC/);
});

test('a new UTC day starts a fresh allowance, without a restart', () => {
  resetMeter();
  record('gpt-4.1', big, day1);
  record('gpt-4.1', big, day1);
  assert.equal(budgetLeft(day2), config.ai.spendBudgetUsd);
  assert.doesNotThrow(() => assertBudget(day2));
});
