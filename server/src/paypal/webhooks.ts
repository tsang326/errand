import { paypalRequest } from './client.js';
import { config } from '../config.js';

/**
 * A webhook is the only part of a payment the app does not initiate, so it is
 * the only part where the sender has to be proved. PayPal signs each
 * notification and offers one endpoint that checks the signature against the
 * webhook's own id; without that check, `POST /api/paypal/webhook` is a public
 * form for minting passes — anyone could post
 * `PAYMENT.CAPTURE.COMPLETED` with an order id and be entitled to 25 searches.
 *
 * Verification is PayPal's call, not ours: we pass the five signature headers
 * and the body exactly as received. That is why the route takes the raw bytes
 * and parses them itself — `JSON.parse` then `JSON.stringify` would re-order
 * keys and change the bytes the signature covers.
 */
export type WebhookHeaders = {
  transmissionId: string;
  transmissionTime: string;
  transmissionSig: string;
  certUrl: string;
  authAlgo: string;
};

export const webhookConfigured = (): boolean => !!config.paypal.webhookId;

/** Pulls the five headers PayPal signs with; undefined when any is missing. */
export function readWebhookHeaders(
  headers: Record<string, string | string[] | undefined>,
): WebhookHeaders | undefined {
  const one = (name: string): string => {
    const value = headers[name];
    return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
  };
  const parsed: WebhookHeaders = {
    transmissionId: one('paypal-transmission-id'),
    transmissionTime: one('paypal-transmission-time'),
    transmissionSig: one('paypal-transmission-sig'),
    certUrl: one('paypal-cert-url'),
    authAlgo: one('paypal-auth-algo'),
  };
  if (Object.values(parsed).some((v) => !v)) return undefined;
  return parsed;
}

/**
 * Asks PayPal whether this body really came from PayPal. Returns false on any
 * answer that is not a plain SUCCESS, including an error from the call itself:
 * a verification we could not complete is not a verification that passed.
 */
export async function verifyWebhook(
  headers: WebhookHeaders,
  event: unknown,
): Promise<boolean> {
  if (!config.paypal.webhookId) return false;
  try {
    const answer = await paypalRequest<{ verification_status?: string }>(
      'POST',
      '/v1/notifications/verify-webhook-signature',
      {
        transmission_id: headers.transmissionId,
        transmission_time: headers.transmissionTime,
        transmission_sig: headers.transmissionSig,
        cert_url: headers.certUrl,
        auth_algo: headers.authAlgo,
        webhook_id: config.paypal.webhookId,
        webhook_event: event,
      },
    );
    return answer.verification_status === 'SUCCESS';
  } catch {
    return false;
  }
}

export type WebhookEvent = {
  id?: string;
  event_type?: string;
  resource?: {
    id?: string;
    status?: string;
    invoice_id?: string;
    custom_id?: string;
    amount?: { value?: string; currency_code?: string };
    supplementary_data?: { related_ids?: { order_id?: string; capture_id?: string } };
    links?: { href?: string; rel?: string }[];
    purchase_units?: { payments?: { captures?: { id?: string }[] } }[];
  };
};

/**
 * Which order a notification is about. PayPal puts it in a different place for
 * each event type: an order event is the order, a capture event carries the
 * order under `supplementary_data.related_ids`.
 */
export function orderIdOf(event: WebhookEvent): string | undefined {
  const type = event.event_type ?? '';
  if (type.startsWith('CHECKOUT.ORDER.')) return event.resource?.id;
  return event.resource?.supplementary_data?.related_ids?.order_id;
}

/**
 * Which capture a refund notification is about. `resource.id` on a refund is
 * the refund's own id, not the capture's — reading it as the capture is how a
 * refund raised in the PayPal dashboard went past us marked "ignored". PayPal
 * names the capture under related_ids, and otherwise in the `up` link.
 */
export function captureIdOf(event: WebhookEvent): string | undefined {
  const related = event.resource?.supplementary_data?.related_ids?.capture_id;
  if (related) return related;
  const up = event.resource?.links?.find((l) => l.rel === 'up')?.href ?? '';
  const inUrl = /\/captures\/([^/?#]+)/.exec(up);
  if (inUrl) return inUrl[1];
  // A REVERSED notification names the capture directly.
  return event.event_type === 'PAYMENT.CAPTURE.REVERSED' ? event.resource?.id : undefined;
}

/** A short, non-sensitive note about what arrived, for the health endpoint. */
export type WebhookNote = {
  at: string;
  type: string;
  orderId?: string;
  action: string;
};

const notes: WebhookNote[] = [];

export function noteWebhook(note: WebhookNote): void {
  notes.unshift(note);
  if (notes.length > 20) notes.length = 20;
}

export const webhookNotes = (): readonly WebhookNote[] => notes;
export function resetWebhookNotes(): void {
  notes.length = 0;
}
