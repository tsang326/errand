import type { CapturedOrder } from './paypal/orders.js';
import { config } from './config.js';

/**
 * What a shopper has actually paid Errand for.
 *
 * The app used to put a PayPal button under a cart of products, which was the
 * wrong transaction: Channel3 has no checkout, the retailer sells the goods,
 * and Errand neither owns nor ships them. Capturing money for that cart bought
 * the shopper nothing.
 *
 * What Errand does own is the search: a Channel3 call and the model calls that
 * judge what comes back. So that is what PayPal is for here — a pass, bought
 * once, spent one errand at a time, and each paid errand reads more of the
 * index than a free one. The capture corresponds to something that exists and
 * is delivered, which is the only honest basis for taking money.
 *
 * Held in memory, like the errands themselves. A restart therefore loses how
 * many runs a pass has spent, and `restore` re-reads the order from PayPal and
 * hands the pass back whole rather than leaving a paying shopper with nothing.
 * Erring toward the shopper is the right direction for a demo; a real
 * deployment would keep this in a database, and the README says so.
 */
export type Pass = {
  orderId: string;
  captureId?: string;
  /** Errands this pass was sold with. */
  runs: number;
  /** Errands spent against it. */
  used: number;
  amount: string;
  currency: string;
  grantedAt: string;
  refundedAt?: string;
};

const passes = new Map<string, Pass>();

export const passRuns = (): number => config.pass.runs;
export const passPrice = (): string => config.pass.price;
export const passCurrency = (): string => config.pass.currency;

/** The pass as the browser should see it: never the internals, always the count. */
export const passView = (p: Pass) => ({
  orderId: p.orderId,
  runs: p.runs,
  used: p.used,
  left: Math.max(0, p.runs - p.used),
  amount: p.amount,
  currency: p.currency,
  ...(p.captureId ? { captureId: p.captureId } : {}),
  ...(p.refundedAt ? { refundedAt: p.refundedAt } : {}),
});

export const getPass = (orderId: string): Pass | undefined => passes.get(orderId);

/**
 * Records a captured order as a pass. Idempotent on the order id, because a
 * double-clicked return from PayPal captures once and arrives twice, and the
 * second arrival must not reset the count.
 */
export function grantPass(captured: CapturedOrder): Pass {
  const existing = passes.get(captured.id);
  if (existing) return existing;
  const pass: Pass = {
    orderId: captured.id,
    ...(captured.captureId ? { captureId: captured.captureId } : {}),
    runs: config.pass.runs,
    used: 0,
    amount: captured.amount ?? config.pass.price,
    currency: captured.currency ?? config.pass.currency,
    grantedAt: new Date().toISOString(),
  };
  passes.set(pass.orderId, pass);
  return pass;
}

/**
 * Spends one errand. Called only once the errand has actually been produced:
 * a run that dies on a Channel3 429 or a model timeout delivered nothing, and
 * charging for it would be the same mistake in a smaller shape.
 */
export function spendRun(orderId: string): boolean {
  const pass = passes.get(orderId);
  if (!pass || pass.refundedAt) return false;
  if (pass.used >= pass.runs) return false;
  pass.used += 1;
  return true;
}

/** True when the pass can pay for one more errand. Does not spend it. */
export function hasRunLeft(orderId: string): boolean {
  const pass = passes.get(orderId);
  return !!pass && !pass.refundedAt && pass.used < pass.runs;
}

/**
 * The pass a capture belongs to. A refund notification names the capture, not
 * the order, so this is how an out-of-band refund finds the pass it voids.
 */
export function findPassByCapture(captureId: string): Pass | undefined {
  for (const pass of passes.values()) {
    if (pass.captureId === captureId) return pass;
  }
  return undefined;
}

/** Marks a pass refunded so its remaining runs cannot be spent afterwards. */
export function markRefunded(orderId: string): void {
  const pass = passes.get(orderId);
  if (pass) pass.refundedAt = new Date().toISOString();
}

/**
 * The amount owed back on an unspent pass, to the cent, as PayPal wants it.
 * Unused runs only: the errands already delivered were delivered.
 */
export function refundDue(pass: Pass): string {
  const left = Math.max(0, pass.runs - pass.used);
  const cents = Math.round((Number(pass.amount) * 100 * left) / pass.runs);
  return (cents / 100).toFixed(2);
}

/** Re-creates a pass the process has forgotten, from an order PayPal confirms. */
export function restore(captured: CapturedOrder): Pass {
  return grantPass(captured);
}

/** Tests only. */
export function resetPasses(): void {
  passes.clear();
}

export const passesHeld = (): number => passes.size;
