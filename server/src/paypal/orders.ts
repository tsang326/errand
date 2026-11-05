import { randomUUID } from 'node:crypto';
import { paypalRequest } from './client.js';
import { toCents, centsToString, sumCents, lineTotal, type Cents } from '../money.js';

export type CartLine = {
  /** Channel3 product id, carried through so a capture can be traced to a row. */
  productId: string;
  title: string;
  /** The retailer domain the offer came from. */
  merchant: string;
  unitPrice: number;
  quantity: number;
  currency: string;
};

export type CreatedOrder = {
  id: string;
  status: string;
  /** Where the shopper approves the payment. Absent means PayPal changed shape. */
  approveUrl?: string;
  total: string;
  currency: string;
};

export type CapturedOrder = {
  id: string;
  status: string;
  captureId?: string;
  amount?: string;
  currency?: string;
  payer?: string;
};

type PayPalLink = { rel?: string; href?: string };
type PayPalOrder = {
  id?: string;
  status?: string;
  links?: PayPalLink[];
  purchase_units?: {
    invoice_id?: string;
    custom_id?: string;
    payments?: {
      captures?: {
        id?: string;
        status?: string;
        amount?: { value?: string; currency_code?: string };
      }[];
    };
  }[];
  payer?: { email_address?: string };
};

/**
 * Builds a PayPal order from a cart of Channel3 offers.
 *
 * PayPal validates arithmetic: the item breakdown must sum to the order total
 * to the cent, or the whole call is a 422 naming the mismatch. So every number
 * is summed in integer cents and formatted once, at the edge. A single currency
 * is enforced for the same reason — purchase_unit carries one currency_code,
 * and a cart that mixes USD and GBP offers has no valid representation here.
 */
/**
 * What this order is, in PayPal's own books.
 *
 * Without these a capture in the PayPal dashboard is an amount and a date, and
 * nothing ties it to the pass the app handed out. With them the two can be
 * reconciled from either side, which is the difference between a payment the
 * app claims and a payment anyone can check.
 */
export type OrderMarks = {
  /** Unique per pass, and unique in the account: PayPal rejects a repeat. */
  invoiceId?: string;
  /** Carried through to the capture webhook, where the app reads it back. */
  customId?: string;
  /** What the payer sees on their statement. Max 22 characters, PayPal trims. */
  softDescriptor?: string;
};

export function buildOrderPayload(
  lines: readonly CartLine[],
  returnUrl: string,
  cancelUrl: string,
  marks: OrderMarks = {},
) {
  if (lines.length === 0) throw new Error('an order needs at least one line');

  const currencies = new Set(lines.map((l) => l.currency));
  if (currencies.size > 1) {
    throw new Error(
      `one order cannot mix currencies: ${[...currencies].sort().join(', ')}`,
    );
  }
  const currency = lines[0]!.currency;

  const items = lines.map((l) => {
    if (!Number.isInteger(l.quantity) || l.quantity < 1) {
      throw new Error(`quantity for ${l.productId} must be a positive integer`);
    }
    return {
      name: l.title.slice(0, 127),
      quantity: String(l.quantity),
      unit_amount: { currency_code: currency, value: centsToString(toCents(l.unitPrice)) },
      // The retailer is recorded on the line so a PayPal receipt alone says
      // which merchant in Channel3's index each item came from.
      description: `from ${l.merchant}`.slice(0, 127),
      sku: l.productId.slice(0, 127),
    };
  });

  const itemTotal: Cents = sumCents(
    lines.map((l) => lineTotal(toCents(l.unitPrice), l.quantity)),
  );

  return {
    intent: 'CAPTURE' as const,
    purchase_units: [
      {
        amount: {
          currency_code: currency,
          value: centsToString(itemTotal),
          breakdown: {
            item_total: { currency_code: currency, value: centsToString(itemTotal) },
          },
        },
        items,
        ...(marks.invoiceId ? { invoice_id: marks.invoiceId.slice(0, 127) } : {}),
        ...(marks.customId ? { custom_id: marks.customId.slice(0, 127) } : {}),
        ...(marks.softDescriptor
          ? { soft_descriptor: marks.softDescriptor.slice(0, 22) }
          : {}),
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          user_action: 'PAY_NOW' as const,
          // Whose checkout the payer thinks they are on. Without it PayPal
          // shows the sandbox account's own name — "Test Store" — which is
          // the wrong answer to "who am I paying?" on a page about trust.
          brand_name: 'Errand',
          // A pass is fifteen searches, so there is nothing to ship. Left at
          // PayPal's default the page asks for a delivery address and then
          // hands back one nobody will ever use.
          shipping_preference: 'NO_SHIPPING' as const,
          locale: 'en-US',
          return_url: returnUrl,
          cancel_url: cancelUrl,
        },
      },
    },
  };
}

export async function createOrder(
  lines: readonly CartLine[],
  returnUrl: string,
  cancelUrl: string,
  marks: OrderMarks = {},
): Promise<CreatedOrder> {
  const payload = buildOrderPayload(lines, returnUrl, cancelUrl, marks);
  const order = await paypalRequest<PayPalOrder>(
    'POST',
    '/v2/checkout/orders',
    payload,
    randomUUID(),
  );
  const approve = order.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve');
  return {
    id: order.id ?? '',
    status: order.status ?? 'UNKNOWN',
    ...(approve?.href ? { approveUrl: approve.href } : {}),
    total: payload.purchase_units[0]!.amount.value,
    currency: payload.purchase_units[0]!.amount.currency_code,
  };
}

/**
 * Captures an approved order. The caller supplies the idempotency key rather
 * than this function minting one, because a retry must reuse the key of the
 * attempt it is retrying — a fresh key on a retry is how a buyer gets charged
 * twice.
 */
export async function captureOrder(orderId: string, requestId: string): Promise<CapturedOrder> {
  const order = await paypalRequest<PayPalOrder>(
    'POST',
    `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    {},
    requestId,
  );
  const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    id: order.id ?? orderId,
    status: order.status ?? 'UNKNOWN',
    ...(capture?.id ? { captureId: capture.id } : {}),
    ...(capture?.amount?.value ? { amount: capture.amount.value } : {}),
    ...(capture?.amount?.currency_code ? { currency: capture.amount.currency_code } : {}),
    ...(order.payer?.email_address ? { payer: order.payer.email_address } : {}),
  };
}

export const getOrder = (orderId: string): Promise<PayPalOrder> =>
  paypalRequest<PayPalOrder>('GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`);

/** What PayPal recorded when money went back. */
export type RefundedCapture = {
  id: string;
  status: string;
  amount?: string;
  currency?: string;
};

/**
 * Hands money back for part or all of a capture.
 *
 * Errand needs this because it sells runs, not goods: a shopper who bought a
 * pass and stopped using it is owed the part they did not spend, and an app
 * that can take money but not return it is asking for trust it has not earned.
 * The request id is derived by the caller from what is being refunded, so a
 * retry cannot refund twice.
 */
export async function refundCapture(
  captureId: string,
  amount: string,
  currency: string,
  requestId: string,
): Promise<RefundedCapture> {
  const refund = await paypalRequest<{
    id?: string;
    status?: string;
    amount?: { value?: string; currency_code?: string };
  }>(
    'POST',
    `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
    { amount: { value: amount, currency_code: currency } },
    requestId,
  );
  // PayPal's refund body may come back without the amount, which left the
  // screen saying a refund happened without saying how much. What we asked for
  // is what was refunded — a refund that did not return this amount throws
  // rather than reaching here — so it is the honest fallback.
  return {
    id: refund.id ?? '',
    status: refund.status ?? 'UNKNOWN',
    amount: refund.amount?.value ?? amount,
    currency: refund.amount?.currency_code ?? currency,
  };
}
