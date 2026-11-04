import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { config, channel3Live, paypalConfigured } from '../config.js';
import { searchProducts, checkPrice, type PriceCheck } from '../channel3/client.js';
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
import { createOrder, captureOrder, type CartLine } from '../paypal/orders.js';
import { rateLimit, rateLimitState } from './ratelimit.js';

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

const errandBody = z.object({ sentence: z.string().min(3).max(500) });

const priceCheckBody = z.object({
  lines: z.array(z.object({ productId: z.string().min(1), price: z.number() })).min(1).max(12),
});

const cartLine = z.object({
  productId: z.string().min(1),
  title: z.string().min(1),
  merchant: z.string(),
  unitPrice: z.number().positive(),
  quantity: z.number().int().positive().max(20),
  currency: z.string().length(3),
});

const orderBody = z.object({
  lines: z.array(cartLine).min(1).max(10),
  returnUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

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
      rate: {
        perHour: config.limits.errandPerHour,
        globalPerHour: config.limits.errandGlobalPerHour,
        seenBy: req.ip ?? 'unknown',
        ...rateLimitState(),
      },
    });
  });

  app.post('/api/errand', async (req: Request, res: Response) => {
    // Before the model call, not after: the point is to not spend the money.
    const caller = req.ip ?? 'unknown';
    const gate = rateLimit(caller, config.limits.errandPerHour, config.limits.errandWindowMs);
    if (!gate.allowed) {
      return fail(res, 429, 'rate_limited', {
        retryAfterSeconds: gate.retryAfterSeconds,
        detail: `This demo allows ${config.limits.errandPerHour} errands an hour from one address.`,
      });
    }
    // The backstop. A caller who rotates X-Forwarded-For gets a fresh per-caller
    // bucket every time; this one they share with everybody. It is set well above
    // what a day of judging needs and well below what a loop costs.
    const all = rateLimit('*all*', config.limits.errandGlobalPerHour, config.limits.errandWindowMs);
    if (!all.allowed) {
      return fail(res, 429, 'rate_limited', {
        retryAfterSeconds: all.retryAfterSeconds,
        detail: 'This demo has run its hourly budget of errands. Try again shortly.',
      });
    }

    const parsed = errandBody.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'sentence must be 3-500 characters');
    const { sentence } = parsed.data;

    try {
      const plan = await planSearch(sentence);
      const search = await searchProducts({
        query: plan.query,
        ...(plan.maxPrice !== undefined ? { maxPrice: plan.maxPrice } : {}),
      });
      const ranking = await rankProducts(sentence, plan, search.products);

      const errand: Errand = {
        id: randomUUID(),
        sentence,
        plan,
        origin: search.origin,
        ...(search.note ? { note: search.note } : {}),
        rows: toRows(search.products, ranking.verdicts),
        createdAt: new Date().toISOString(),
        ranking: { source: ranking.source, costUsd: Number(ranking.costUsd.toFixed(4)) },
      };
      errands.set(errand.id, errand);

      return res.json(errand);
    } catch (err) {
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

  app.post('/api/order', async (req: Request, res: Response) => {
    const parsed = orderBody.safeParse(req.body);
    if (!parsed.success) {
      return fail(res, 400, 'bad cart', { detail: parsed.error.issues.slice(0, 4) });
    }
    if (!paypalConfigured()) return fail(res, 503, 'PayPal is not configured on this deployment');

    const { lines, returnUrl, cancelUrl } = parsed.data;
    try {
      const order = await createOrder(
        lines as CartLine[],
        returnUrl ?? `${config.publicUrl}/paid`,
        cancelUrl ?? `${config.publicUrl}/cancelled`,
      );
      return res.json(order);
    } catch (err) {
      return fail(res, 502, (err as Error).message.slice(0, 400));
    }
  });

  app.post('/api/order/:id/capture', async (req: Request, res: Response) => {
    if (!paypalConfigured()) return fail(res, 503, 'PayPal is not configured on this deployment');
    const orderId = String(req.params.id ?? '');
    // The idempotency key is derived from the order, not minted per request, so
    // a double-clicked capture replays the first answer instead of charging
    // twice.
    try {
      const captured = await captureOrder(orderId, `capture-${orderId}`);
      return res.json(captured);
    } catch (err) {
      return fail(res, 502, (err as Error).message.slice(0, 400));
    }
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
