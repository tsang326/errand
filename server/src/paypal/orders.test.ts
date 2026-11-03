import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrderPayload, type CartLine } from './orders.js';

const line = (over: Partial<CartLine> = {}): CartLine => ({
  productId: 'I8Kcjj2',
  title: 'Dinosaur Egg Toys',
  merchant: 'kohls.com',
  unitPrice: 34.12,
  quantity: 1,
  currency: 'USD',
  ...over,
});

const payload = (lines: CartLine[]) =>
  buildOrderPayload(lines, 'https://example.test/done', 'https://example.test/cancel');

test('the breakdown sums to the total, which is what PayPal validates', () => {
  const p = payload([line({ quantity: 3 })]);
  const unit = p.purchase_units[0]!;
  assert.equal(unit.amount.value, '102.36');
  assert.equal(unit.amount.breakdown.item_total.value, '102.36');
  assert.equal(unit.items[0]!.unit_amount.value, '34.12');
  assert.equal(unit.items[0]!.quantity, '3');
});

test('several lines add up in cents, not in floats', () => {
  const p = payload([
    line({ unitPrice: 34.12, quantity: 3 }),
    line({ productId: 'b', unitPrice: 18.5, quantity: 1 }),
  ]);
  assert.equal(p.purchase_units[0]!.amount.value, '120.86');
});

test('a cart mixing currencies is refused, naming both', () => {
  assert.throws(
    () => payload([line(), line({ productId: 'b', currency: 'GBP' })]),
    /cannot mix currencies: GBP, USD/,
  );
});

test('the retailer and the Channel3 id ride along on each line', () => {
  const item = payload([line()]).purchase_units[0]!.items[0]!;
  assert.equal(item.sku, 'I8Kcjj2');
  assert.equal(item.description, 'from kohls.com');
});

test('a fractional or zero quantity is refused before PayPal sees it', () => {
  assert.throws(() => payload([line({ quantity: 0 })]), /positive integer/);
  assert.throws(() => payload([line({ quantity: 1.5 })]), /positive integer/);
});

test('an empty cart is refused', () => {
  assert.throws(() => payload([]), /at least one line/);
});

test('a title longer than PayPal allows is truncated, not rejected', () => {
  const item = payload([line({ title: 'x'.repeat(300) })]).purchase_units[0]!.items[0]!;
  assert.equal(item.name.length, 127);
});

test('PAY_NOW is asked for, so the shopper does not land on a review page', () => {
  const ctx = payload([line()]).payment_source.paypal.experience_context;
  assert.equal(ctx.user_action, 'PAY_NOW');
  assert.equal(ctx.return_url, 'https://example.test/done');
});
