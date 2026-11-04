import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readWebhookHeaders,
  orderIdOf,
  verifyWebhook,
  noteWebhook,
  webhookNotes,
  resetWebhookNotes,
  type WebhookEvent,
} from './webhooks.js';
import { buildOrderPayload, type CartLine } from './orders.js';

const sigHeaders = {
  'paypal-transmission-id': 'tx-1',
  'paypal-transmission-time': '2026-11-04T10:00:00Z',
  'paypal-transmission-sig': 'sig',
  'paypal-cert-url': 'https://api.sandbox.paypal.com/cert.pem',
  'paypal-auth-algo': 'SHA256withRSA',
};

test('all five signature headers are required, not four', () => {
  assert.ok(readWebhookHeaders(sigHeaders));
  for (const name of Object.keys(sigHeaders)) {
    const missing = { ...sigHeaders, [name]: undefined };
    assert.equal(readWebhookHeaders(missing), undefined, `${name} should be required`);
  }
});

test('an unverifiable event is never treated as genuine', async () => {
  // No PAYPAL_WEBHOOK_ID is set in the test environment, so verification
  // cannot be performed — and must therefore fail closed rather than open.
  assert.equal(await verifyWebhook(readWebhookHeaders(sigHeaders)!, { event_type: 'X' }), false);
});

test('an order event names the order; a capture event hides it one level down', () => {
  const approved: WebhookEvent = {
    event_type: 'CHECKOUT.ORDER.APPROVED',
    resource: { id: '5O190127TN364715T' },
  };
  assert.equal(orderIdOf(approved), '5O190127TN364715T');

  const captured: WebhookEvent = {
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: {
      id: '3C679366HH908993F',
      supplementary_data: { related_ids: { order_id: '5O190127TN364715T' } },
    },
  };
  assert.equal(orderIdOf(captured), '5O190127TN364715T');
  assert.equal(orderIdOf({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {} }), undefined);
});

test('the notes keep the last twenty events and nothing older', () => {
  resetWebhookNotes();
  for (let i = 0; i < 25; i += 1) {
    noteWebhook({ at: new Date().toISOString(), type: `T${i}`, action: 'ignored' });
  }
  const notes = webhookNotes();
  assert.equal(notes.length, 20);
  assert.equal(notes[0]!.type, 'T24');
  resetWebhookNotes();
});

const line: CartLine = {
  productId: 'errand-pass',
  title: 'Errand: 25 agent searches',
  merchant: 'Errand',
  unitPrice: 3,
  quantity: 1,
  currency: 'USD',
};

test('the order carries the marks that let PayPal and Errand be reconciled', () => {
  const p = buildOrderPayload([line], 'https://e.test/paid', 'https://e.test/cancelled', {
    invoiceId: 'pass-abc',
    customId: 'pass-abc',
    softDescriptor: 'ERRAND PASS',
  });
  const unit = p.purchase_units[0]!;
  assert.equal(unit.invoice_id, 'pass-abc');
  assert.equal(unit.custom_id, 'pass-abc');
  assert.equal(unit.soft_descriptor, 'ERRAND PASS');
});

test('a soft descriptor over PayPal’s 22 characters is trimmed, not rejected', () => {
  const p = buildOrderPayload([line], 'https://e.test/paid', 'https://e.test/cancelled', {
    softDescriptor: 'ERRAND PASS FOR AGENT SEARCHES',
  });
  assert.equal(p.purchase_units[0]!.soft_descriptor!.length, 22);
});

test('an order with no marks stays exactly as it was', () => {
  const p = buildOrderPayload([line], 'https://e.test/paid', 'https://e.test/cancelled');
  const unit = p.purchase_units[0]! as Record<string, unknown>;
  assert.equal('invoice_id' in unit, false);
  assert.equal('custom_id' in unit, false);
  assert.equal('soft_descriptor' in unit, false);
});
