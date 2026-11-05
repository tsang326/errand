import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  verifyWebhook,
  readWebhookHeaders,
  webhookConfigured,
  orderIdOf,
  captureIdOf,
  noteWebhook,
  webhookNotes,
  type WebhookEvent,
} from '../paypal/webhooks.js';
import { deviceId } from './device.js';
import { config, channel3Live, paypalConfigured } from '../config.js';
import { searchProducts, searchPages, checkPrice, type PriceCheck } from '../channel3/client.js';
import { cheapestOffer, bestCommission, type Product } from '../channel3/types.js';
import {
  planSearch,
  rankProducts,
  fitOf,
  missesOf,
  type Plan,
  type Verdict,
  type Mark,
} from '../ai/shopper.js';
import { meterState } from '../ai/meter.js';
import {
  createOrder,
  captureOrder,
  refundCapture,
  getOrder,
  type CartLine,
} from '../paypal/orders.js';
import { rateLimit, rateLimitBuckets, rateLimitState } from './ratelimit.js';
import {
  getPass,
  grantPass,
  findPassByCapture,
  hasRunLeft,
  markRefunded,
  passCurrency,
  passPrice,
  passRuns,
  passView,
  passesHeld,
  refundDue,
  spendRun,
  releaseRun,
} from '../passes.js';

/** One row as the grid consumes it: the product, its best offer, the agent's verdict. */
export type Row = {
  productId: string;
  title: string;
  brand: string;
  imageUrl: string;
  category: string;
  categoryPath: string[];
  retailer: string;
  /**
   * Channel3's buy link for that offer, which is where the product actually
   * lives. Without it the shortlist is a claim about real listings that the
   * reader has no way to check.
   */
  url: string;
  price: number | null;
  compareAtPrice: number | null;
  currency: string;
  inStock: boolean;
  offerCount: number;
  /**
   * Every offer the index holds for this product, cheapest first, not just the
   * one the row is priced at. The same sealed booster box came back at $120 on
   * stockx.com, $304.17 on bestbuy.com and $422.37 on kickscrew.com; showing
   * only the first made a 3.5x spread look like a price.
   */
  offers: RowOffer[];
  commissionRate: number;
  attributes: Record<string, string[]>;
  keyFeatures: string[];
  /** One mark per requirement, in the plan's order; empty if the agent never judged this row. */
  marks: Mark[];
  /** Derived from the marks, never scored separately. Null when there are none. */
  fit: number | null;
  why: string;
  /** The notes of the requirements this row fails. Derived from the marks. */
  misses: string[];
};

export type RowOffer = {
  retailer: string;
  url: string;
  price: number;
  currency: string;
  inStock: boolean;
};

export function toRows(products: readonly Product[], verdicts: readonly Verdict[]): Row[] {
  const byId = new Map(verdicts.map((v) => [v.productId, v]));
  return products.map((p) => {
    const offer = cheapestOffer(p);
    const v = byId.get(p.id);
    return {
      productId: p.id,
      title: p.title,
      brand: p.brand,
      imageUrl: p.imageUrl,
      category: p.category,
      categoryPath: p.categoryPath,
      retailer: offer?.domain ?? '',
      url: offer?.url ?? '',
      price: offer?.price ?? null,
      compareAtPrice: offer?.compareAtPrice ?? null,
      currency: offer?.currency ?? 'USD',
      inStock: offer?.inStock ?? false,
      offerCount: p.offers.length,
      offers: [...p.offers]
        .sort((a, b) => a.price - b.price)
        .map((o) => ({
          retailer: o.domain,
          url: o.url,
          price: o.price,
          currency: o.currency,
          inStock: o.inStock,
        })),
      commissionRate: bestCommission(p),
      attributes: p.attributes,
      keyFeatures: p.keyFeatures,
      // A row the model never judged shows an empty cell, not a zero: zero
      // would read as "the agent looked and rejected it".
      marks: v?.marks ?? [],
      fit: v ? fitOf(v.marks) : null,
      why: v?.why ?? '',
      misses: v ? missesOf(v.marks) : [],
    };
  });
}

type Errand = {
  id: string;
  sentence: string;
  plan: Plan;
  origin: 'live' | 'fixture';
  note?: string;
  /** Pages of the Channel3 index this errand read. */
  pagesRead?: number;
  /** True when a pass paid for it, which is why it read more than one page. */
  deep?: boolean;
  rows: Row[];
  createdAt: string;
  /** Stored, not just returned: reopening an errand must give the same shape. */
  ranking: { source: 'model' | 'passthrough'; costUsd: number };
};

/**
 * Errands live in memory only. The free Render plan has no disk, so a database
 * here would be rebuilt on every cold start anyway; saying so beats shipping a
 * file that silently vanishes.
 */
const errands = new Map<string, Errand>();

const errandBody = z.object({
  sentence: z.string().min(3).max(500),
  /** A pass the shopper bought, spent one errand at a time. */
  pass: z.string().min(1).max(64).optional(),
});

const priceCheckBody = z.object({
  lines: z.array(z.object({ productId: z.string().min(1), price: z.number() })).min(1).max(12),
});

const passOrderBody = z.object({
  returnUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

/**
 * A stable, non-identifying tag for one caller, for Channel3's `x-user-id`.
 * The address itself never leaves this process: it is a third party's log, and
 * the only thing they need is that two searches came from the same person.
 */
const callerTag = (ip: string): string =>
  createHash('sha256').update(`errand:${ip}`).digest('hex').slice(0, 16);

const passViewOf = (orderId: string) => {
  const pass = getPass(orderId);
  return pass ? passView(pass) : undefined;
};

const fail = (res: Response, status: number, error: string, extra: object = {}): void => {
  res.status(status).json({ error, ...extra });
};

export function buildApp() {
  const app = express();
  // Trust the whole forwarding chain, so req.ip is the leftmost entry of
  // X-Forwarded-For: the caller. Trusting exactly one hop was wrong here and
  // measured so on the live instance — /api/health reported seenBy
  // 10.192.131.22 then 10.196.147.54 on two consecutive requests, Render's own
  // internal mesh addresses, which rotate. The limiter was keying on those, so
  // four requests landed in two buckets and no ceiling was ever reached.
  //
  // The leftmost entry is client-supplied and therefore spoofable, which is why
  // the route also holds a global ceiling behind the per-caller one: rotating a
  // header gets past the first and not the second.
  app.set('trust proxy', true);
  app.use(cors());
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', (req: Request, res: Response) => {
    res.json({
      ok: true,
      products: channel3Live() ? 'channel3-live' : 'fixtures',
      searchMode: config.channel3.mode,
      paypal: paypalConfigured() ? (config.paypal.sandbox ? 'sandbox' : 'live') : 'unconfigured',
      model: config.openai.apiKey ? config.openai.model : 'none',
      ai: meterState(),
      errandsHeld: errands.size,
      pass: { runs: passRuns(), price: passPrice(), currency: passCurrency(), held: passesHeld() },
      webhooks: { configured: webhookConfigured(), seen: webhookNotes().slice(0, 5) },
      rate: {
        freeRunsPerDay: config.limits.freeRuns,
        freeRunsPerAddressDay: config.limits.freeRunsPerAddress,
        paidPages: config.channel3.paidPages,
        globalPerHour: config.limits.errandGlobalPerHour,
        seenBy: req.ip ?? 'unknown',
        ...rateLimitState(),
      },
    });
  });

/**
 * The free allowance: per device, and per address at five devices' worth.
 * One call, so a refusal on either count charges neither.
 */
const freeGate = (caller: string, device: string) =>
  rateLimitBuckets(
    [
      { key: `dev:${device}`, limit: config.limits.freeRuns },
      { key: `ip:${caller}`, limit: config.limits.freeRunsPerAddress },
    ],
    config.limits.freeWindowMs,
  );

  app.post('/api/errand', async (req: Request, res: Response) => {
    // Before the model call, not after: the point is to not spend the money.
    const caller = req.ip ?? 'unknown';
    const parsedEarly = errandBody.safeParse(req.body);
    const passId = parsedEarly.success ? parsedEarly.data.pass : undefined;
    // A pass that still has runs on it skips the free ceiling, because the
    // ceiling exists to stop strangers spending my money and this caller is
    // spending their own. It skips the global hourly one too (see below).
    const paying = !!passId && hasRunLeft(passId);
    if (passId && !paying) {
      const known = getPass(passId);
      return fail(res, 402, 'pass_spent', {
        detail: known
          ? `That pass has used all ${known.runs} of its errands.`
          : 'That pass is not known to this instance. Reload the page to restore it from PayPal.',
      });
    }
    // Free errands are counted per device as well as per address. An office,
    // a campus or a mobile carrier puts many real people behind one address,
    // and they were sharing one allowance between them; a device of its own
    // gets its own five. Both buckets have to have room, so neither is a way
    // round the other — and neither is anti-bot: see http/device.ts.
    const device = paying ? undefined : deviceId(req, res);
    // Two counts, two ceilings. The device gets the allowance proper; the
    // address gets five devices' worth, because the address is shared and the
    // device is not. Counting both at the same ceiling, which is what the
    // first version of this did, left a whole office sharing five errands —
    // it tightened the limit instead of making it fair.
    const gate = paying
      ? { allowed: true as const }
      : freeGate(caller, device as string);
    if (!gate.allowed) {
      return fail(res, 402, 'free_runs_spent', {
        retryAfterSeconds: gate.retryAfterSeconds,
        detail: `The free errands for today are spent — ${config.limits.freeRuns} per device, ${config.limits.freeRunsPerAddress} per address. A pass covers ${passRuns()} more, and reads more of the index on each one.`,
        pass: { runs: passRuns(), price: passPrice(), currency: passCurrency() },
      });
    }
    // The backstop against the free path. A caller who rotates X-Forwarded-For
    // gets a fresh per-caller bucket every time; this one they share with
    // everybody.
    //
    // Paid runs are outside it on purpose. The ceiling exists to bound what
    // strangers can spend of mine, and a pass is already bounded by something
    // better: it was paid for and it has a fixed number of runs on it, so it
    // cannot be a spam vector however often it is called. Leaving it inside
    // meant a shopper who had paid could be refused because other people's
    // free errands had filled the hour, which is the one refusal this app has
    // no right to make.
    const all = paying
      ? { allowed: true as const }
      : rateLimit('*all*', config.limits.errandGlobalPerHour, config.limits.errandWindowMs);
    if (!all.allowed) {
      return fail(res, 429, 'rate_limited', {
        retryAfterSeconds: all.retryAfterSeconds,
        detail: 'This demo has run its hourly budget of errands. Try again shortly.',
      });
    }

    if (!parsedEarly.success) return fail(res, 400, 'sentence must be 3-500 characters');
    const { sentence } = parsedEarly.data;

    // The run is taken before the work, not after it. An errand takes most of
    // a minute, and a refund asked for inside that minute used to pay back a
    // run that the agent then delivered anyway.
    if (paying && passId) spendRun(passId);

    try {
      const plan = await planSearch(sentence);
      // What a pass actually buys: the same agent over a wider field. A free
      // errand reads one page of the index, a paid one reads several, so the
      // difference a shopper pays for is in the search rather than in a
      // counter.
      const search = await searchPages(
        {
          query: plan.query,
          ...(plan.maxPrice !== undefined ? { maxPrice: plan.maxPrice } : {}),
          // Channel3 attributes clicks and commission per user when the search
          // carries one. A paid shopper is identified by their pass; everyone
          // else by their address, hashed, because the id is sent to a third
          // party and an IP is not ours to hand over.
          userId: passId ? `pass-${passId}` : `anon-${callerTag(caller)}`,
        },
        paying ? config.channel3.paidPages : 1,
      );
      const ranking = await rankProducts(sentence, plan, search.products);

      const errand: Errand = {
        id: randomUUID(),
        sentence,
        plan,
        origin: search.origin,
        ...(search.pagesRead !== undefined ? { pagesRead: search.pagesRead } : {}),
        deep: paying,
        ...(search.note ? { note: search.note } : {}),
        rows: toRows(search.products, ranking.verdicts),
        createdAt: new Date().toISOString(),
        ranking: { source: ranking.source, costUsd: Number(ranking.costUsd.toFixed(4)) },
      };
      errands.set(errand.id, errand);

      return res.json({ ...errand, ...(passId ? { pass: passViewOf(passId) } : {}) });
    } catch (err) {
      // Nothing was delivered, so nothing is owed: the reserved run goes back.
      if (paying && passId) releaseRun(passId);
      const e = err as Error & { code?: string; status?: number };
      if (e.code === 'ai_budget_spent') return fail(res, 429, e.message, { code: e.code });
      // An upstream deadline carries its own status (504/502); keeping it tells
      // the page the difference between "too slow" and "wrong answer".
      return fail(res, e.status ?? 502, e.message.slice(0, 300), e.code ? { code: e.code } : {});
    }
  });

  app.get('/api/errand/:id', (req: Request, res: Response) => {
    const errand = errands.get(String(req.params.id ?? ''));
    if (!errand) return fail(res, 404, 'no such errand');
    return res.json(errand);
  });

  /**
   * Re-reads the price of the rows the shopper ticked against Channel3's own
   * price-tracking history, before any money is proposed. Two endpoints of the
   * same index can disagree — /search served $120 for a booster box whose
   * tracked history had moved to $304.17 four days earlier — and the shopper
   * is the one who would have paid the difference. So the check runs where it
   * matters rather than being described in a caveat.
   */
  app.post('/api/price-check', async (req: Request, res: Response) => {
    const parsed = priceCheckBody.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'bad price-check request');
    const lines = parsed.data.lines.slice(0, 12);
    try {
      const checks = await Promise.all(
        lines.map((l) =>
          // One bad history must not cost the shopper the whole check.
          checkPrice(l.productId, l.price).catch(
            (): PriceCheck => ({
              productId: l.productId,
              indexedPrice: l.price,
              trackedPrice: null,
              trackedOn: null,
              lastChange: null,
              disagrees: false,
            }),
          ),
        ),
      );
      return res.json({ checks, tracked: checks.filter((c) => c.trackedPrice !== null).length });
    } catch (err) {
      const e = err as Error & { status?: number };
      return fail(res, e.status ?? 502, 'price check failed', { detail: e.message });
    }
  });

  /**
   * Buys a pass. The browser sends nothing but where to come back to: the price
   * and the size of the pass are the server's, which is the difference between
   * selling your own product and forwarding a cart a stranger priced.
   */
  app.post('/api/pass/order', async (req: Request, res: Response) => {
    if (!paypalConfigured()) return fail(res, 503, 'PayPal is not configured on this deployment');
    const parsed = passOrderBody.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'bad return urls');
    const line: CartLine = {
      productId: 'errand-pass',
      title: `Errand: ${passRuns()} agent searches`,
      merchant: 'Errand',
      unitPrice: Number(passPrice()),
      quantity: 1,
      currency: passCurrency(),
    };
    // What ties this payment to this pass in PayPal's own records. The
    // reference is minted here, before the order exists, because PayPal will
    // only accept an invoice number once — which is also what stops the same
    // pass being invoiced twice.
    const ref = `pass-${randomUUID()}`;
    try {
      const order = await createOrder(
        [line],
        parsed.data.returnUrl ?? `${config.publicUrl}/paid`,
        parsed.data.cancelUrl ?? `${config.publicUrl}/cancelled`,
        {
          invoiceId: ref,
          customId: ref,
          softDescriptor: 'ERRAND PASS',
        },
      );
      return res.json(order);
    } catch (err) {
      return fail(res, 502, (err as Error).message.slice(0, 400));
    }
  });

  /** Takes the money, and only then is there a pass. */
  app.post('/api/pass/:id/capture', async (req: Request, res: Response) => {
    if (!paypalConfigured()) return fail(res, 503, 'PayPal is not configured on this deployment');
    const orderId = String(req.params.id ?? '');
    const already = getPass(orderId);
    if (already) return res.json({ captured: null, pass: passView(already) });
    try {
      const captured = await captureOrder(orderId, `capture-${orderId}`);
      if (captured.status !== 'COMPLETED') {
        return fail(res, 402, `PayPal returned ${captured.status}`, { captured });
      }
      return res.json({ captured, pass: passView(grantPass(captured)) });
    } catch (err) {
      return fail(res, 502, (err as Error).message.slice(0, 400));
    }
  });

  /**
   * The pass this browser is holding. Asked on load, which is also how a pass
   * survives a restart: the process forgets, PayPal does not, so an order it
   * confirms as COMPLETED is handed back as a whole pass.
   */
  app.get('/api/pass/:id', async (req: Request, res: Response) => {
    const orderId = String(req.params.id ?? '');
    const held = getPass(orderId);
    if (held) return res.json({ pass: passView(held) });
    if (!paypalConfigured()) return fail(res, 404, 'no such pass');
    try {
      const order = await getOrder(orderId);
      if (order.status !== 'COMPLETED') return fail(res, 404, 'no such pass');
      const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
      const restored = grantPass({
        id: order.id ?? orderId,
        status: order.status,
        ...(capture?.id ? { captureId: capture.id } : {}),
        ...(capture?.amount?.value ? { amount: capture.amount.value } : {}),
        ...(capture?.amount?.currency_code ? { currency: capture.amount.currency_code } : {}),
      });
      return res.json({ pass: passView(restored), restored: true });
    } catch {
      return fail(res, 404, 'no such pass');
    }
  });

  /**
   * Hands back what the pass has not spent. An app that can take money and not
   * return it is asking for trust it has not earned, and the agent's own output
   * is the thing being sold: if it was not worth the runs, the runs are owed.
   */
  app.post('/api/pass/:id/refund', async (req: Request, res: Response) => {
    if (!paypalConfigured()) return fail(res, 503, 'PayPal is not configured on this deployment');
    const pass = getPass(String(req.params.id ?? ''));
    if (!pass) return fail(res, 404, 'no such pass');
    if (pass.refundedAt) return fail(res, 409, 'that pass was already refunded');
    if (!pass.captureId) return fail(res, 409, 'that pass has no capture to refund');
    const due = refundDue(pass);
    if (Number(due) <= 0) {
      return fail(res, 409, 'that pass has been spent in full', { pass: passView(pass) });
    }
    try {
      const refund = await refundCapture(
        pass.captureId,
        due,
        pass.currency,
        `refund-${pass.orderId}`,
      );
      markRefunded(pass.orderId);
      return res.json({ refund, pass: passView(pass) });
    } catch (err) {
      return fail(res, 502, (err as Error).message.slice(0, 400));
    }
  });

  /**
   * What PayPal says about this order, read live from PayPal rather than from
   * our own memory. The point is that the app's claim is checkable: the
   * shopper sees the status, the capture id and the invoice number that the
   * PayPal dashboard shows for the same payment.
   */
  app.get('/api/pass/:id/status', async (req: Request, res: Response) => {
    if (!paypalConfigured()) return fail(res, 503, 'PayPal is not configured on this deployment');
    const orderId = String(req.params.id ?? '');
    try {
      const order = await getOrder(orderId);
      const unit = order.purchase_units?.[0];
      const capture = unit?.payments?.captures?.[0];
      const held = getPass(orderId);
      return res.json({
        paypal: {
          id: order.id ?? orderId,
          status: order.status ?? 'UNKNOWN',
          ...(unit?.invoice_id ? { invoiceId: unit.invoice_id } : {}),
          ...(capture?.id ? { captureId: capture.id } : {}),
          ...(capture?.status ? { captureStatus: capture.status } : {}),
          ...(capture?.amount?.value ? { amount: capture.amount.value } : {}),
          ...(capture?.amount?.currency_code ? { currency: capture.amount.currency_code } : {}),
        },
        ...(held ? { pass: passView(held) } : {}),
        // What PayPal told this server about the order on its own, oldest
        // first. Only notifications whose signature PayPal verified are ever
        // noted, so this is the evidence that the capture did not depend on
        // the shopper's tab coming back.
        webhooks: webhookNotes()
          .filter((n) => n.orderId === orderId)
          .map(({ at, type, action }) => ({ at, type, action }))
          .reverse(),
      });
    } catch (err) {
      return fail(res, 502, (err as Error).message.slice(0, 400));
    }
  });

  /**
   * PayPal telling the server what happened, instead of the server finding out
   * only because the shopper's browser came back.
   *
   * That difference is the whole reason this route exists. Capture used to
   * happen on the return URL alone, so a closed tab between "approve" and
   * "back to Errand" left the order APPROVED forever: the shopper had
   * approved a payment, nobody was charged, and no pass existed. Here PayPal
   * reports the approval directly and the server captures it, so the outcome
   * no longer depends on a browser surviving a redirect.
   *
   * Nothing is trusted before the signature is verified. An unverified body is
   * a stranger's POST claiming somebody paid, and acting on it would hand out
   * passes for free; so an unverified event is answered 400 and dropped.
   */
  app.post('/api/paypal/webhook', async (req: Request, res: Response) => {
    if (!webhookConfigured()) {
      return fail(res, 503, 'PAYPAL_WEBHOOK_ID is not set on this deployment');
    }
    const headers = readWebhookHeaders(req.headers as Record<string, string | undefined>);
    if (!headers) return fail(res, 400, 'missing PayPal signature headers');

    const event = req.body as WebhookEvent;
    // The parsed body is sent on for verification, not a re-serialised string
    // of our own: PayPal rebuilds the signed payload from these fields, and
    // the only thing we must not do is edit them.
    const genuine = await verifyWebhook(headers, event);
    if (!genuine) return fail(res, 400, 'PayPal did not verify that signature');

    const type = event.event_type ?? 'UNKNOWN';
    const orderId = orderIdOf(event);
    let action = 'ignored';

    try {
      if (type === 'CHECKOUT.ORDER.APPROVED' && orderId) {
        if (getPass(orderId)) {
          action = 'already captured';
        } else {
          const captured = await captureOrder(orderId, `capture-${orderId}`);
          action = `captured ${captured.status}`;
          if (captured.status === 'COMPLETED') {
            grantPass(captured);
            action = 'captured and pass granted';
          }
        }
      } else if (type === 'PAYMENT.CAPTURE.COMPLETED' && orderId) {
        const capture = event.resource;
        grantPass({
          id: orderId,
          status: 'COMPLETED',
          ...(capture?.id ? { captureId: capture.id } : {}),
          ...(capture?.amount?.value ? { amount: capture.amount.value } : {}),
          ...(capture?.amount?.currency_code ? { currency: capture.amount.currency_code } : {}),
        });
        action = 'pass granted';
      } else if (type === 'PAYMENT.CAPTURE.REFUNDED' || type === 'PAYMENT.CAPTURE.REVERSED') {
        // A refund can start on PayPal's side, not ours, and then the capture
        // is all the notification names.
        const captureId = captureIdOf(event);
        const pass =
          (orderId ? getPass(orderId) : undefined) ??
          (captureId ? findPassByCapture(captureId) : undefined);
        if (pass) {
          markRefunded(pass.orderId);
          action = 'pass marked refunded';
        }
      }
    } catch (err) {
      // PayPal retries a webhook it could not deliver. A 502 here is therefore
      // the useful answer: it asks for that retry instead of swallowing a
      // capture that failed once.
      noteWebhook({ at: new Date().toISOString(), type, ...(orderId ? { orderId } : {}), action: 'failed' });
      return fail(res, 502, (err as Error).message.slice(0, 400));
    }

    noteWebhook({ at: new Date().toISOString(), type, ...(orderId ? { orderId } : {}), action });
    return res.json({ ok: true, type, action });
  });

  // One service serves both halves, which is what the deployment target gives
  // us and what keeps the browser's fetch paths same-origin. The API routes are
  // registered above, so they always win over the static handler.
  const web = join(dirname(fileURLToPath(import.meta.url)), '../../../web/dist');
  if (existsSync(web)) {
    app.use(express.static(web));
    // Anything that is not an API route and not a file is the app itself: the
    // errand id lives in the hash, but PayPal's return_url is a real path.
    app.get(/^(?!\/api\/).*/, (_req: Request, res: Response) => {
      res.sendFile(join(web, 'index.html'));
    });
  }

  return app;
}
