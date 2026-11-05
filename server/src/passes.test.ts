import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getPass,
  grantPass,
  hasRunLeft,
  markRefunded,
  refundDue,
  resetPasses,
  spendRun,
  releaseRun,
} from './passes.js';

const captured = (id: string, amount = '3.00') => ({
  id,
  status: 'COMPLETED',
  captureId: `cap-${id}`,
  amount,
  currency: 'USD',
});

test('a captured order becomes a pass with every run unspent', () => {
  resetPasses();
  const pass = grantPass(captured('A'));
  assert.equal(pass.used, 0);
  assert.equal(pass.runs > 0, true);
  assert.equal(pass.captureId, 'cap-A');
});

test('granting the same order twice does not reset the count', () => {
  // PayPal's return URL is reloadable, and a shopper who reloads it must not
  // get their spent runs back.
  resetPasses();
  grantPass(captured('B'));
  assert.equal(spendRun('B'), true);
  const again = grantPass(captured('B'));
  assert.equal(again.used, 1);
});

test('a pass stops paying once its runs are gone', () => {
  resetPasses();
  const pass = grantPass(captured('C'));
  for (let i = 0; i < pass.runs; i += 1) assert.equal(spendRun('C'), true);
  assert.equal(hasRunLeft('C'), false);
  assert.equal(spendRun('C'), false);
  assert.equal(getPass('C')?.used, pass.runs);
});

test('an unknown pass pays for nothing', () => {
  resetPasses();
  assert.equal(hasRunLeft('nope'), false);
  assert.equal(spendRun('nope'), false);
});

test('the refund is the unspent part, to the cent', () => {
  resetPasses();
  const pass = grantPass(captured('D', '3.00'));
  assert.equal(refundDue(pass), '3.00');
  spendRun('D');
  // 24 of 25 runs left on $3.00 is $2.88, not $2.8799999999999994.
  const left = pass.runs - 1;
  assert.equal(refundDue(pass), ((Math.round((300 * left) / pass.runs) / 100)).toFixed(2));
});

test('a spent pass is owed nothing', () => {
  resetPasses();
  const pass = grantPass(captured('E'));
  for (let i = 0; i < pass.runs; i += 1) spendRun('E');
  assert.equal(refundDue(pass), '0.00');
});

test('a refunded pass cannot be spent afterwards', () => {
  resetPasses();
  grantPass(captured('F'));
  markRefunded('F');
  assert.equal(hasRunLeft('F'), false);
  assert.equal(spendRun('F'), false);
});

test('a run reserved for an errand that never arrives is given back', () => {
  resetPasses();
  const pass = grantPass({ id: 'o-release', status: 'COMPLETED', captureId: 'c-release', amount: '3.00', currency: 'USD' });
  assert.equal(spendRun(pass.orderId), true);
  assert.equal(getPass(pass.orderId)?.used, 1);
  releaseRun(pass.orderId);
  assert.equal(getPass(pass.orderId)?.used, 0);
  // Never below zero, however often it is called.
  releaseRun(pass.orderId);
  assert.equal(getPass(pass.orderId)?.used, 0);
});
