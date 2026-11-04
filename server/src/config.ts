import 'dotenv/config';

const str = (name: string, fallback = ''): string => process.env[name]?.trim() || fallback;

export const config = {
  port: Number(str('PORT', '8787')),
  /** Where this deployment is reachable; PayPal redirects the shopper back here. */
  publicUrl: str('ERRAND_PUBLIC_URL', 'http://localhost:5173'),

  // Channel3 supplies the products. Without a key the server answers from the
  // bundled fixtures and says so in every response, rather than pretending to
  // have searched 100M products. That keeps the app developable before a key
  // exists and keeps a demo honest about where its rows came from.
  channel3: {
    apiKey: str('CHANNEL3_API_KEY'),
    baseUrl: str('CHANNEL3_BASE_URL', 'https://api.trychannel3.com/v1'),
    // agentic mode has an LLM turn natural shopping language into real filters;
    // it is slower than keyword search, which is the right trade here because a
    // shopper types a sentence, not a filter tree.
    mode: str('CHANNEL3_MODE', 'agentic'),
    limit: Number(str('CHANNEL3_LIMIT', '24')),
  },

  paypal: {
    clientId: str('PAYPAL_CLIENT_ID'),
    clientSecret: str('PAYPAL_CLIENT_SECRET'),
    sandbox: str('PAYPAL_SANDBOX', 'true') !== 'false',
  },

  openai: {
    apiKey: str('OPENAI_API_KEY'),
    model: str('ERRAND_MODEL', 'gpt-4.1'),
  },

  ai: {
    // A hard ceiling on what the model can cost this process. Judging runs
    // 1-15 December on a public URL, so the thing to bound is what a stranger
    // can spend, and money is the one budget here that does not refill.
    spendBudgetUsd: Number(str('ERRAND_AI_SPEND_USD', '3.00')),
    // How many products the ranking step is allowed to read in one call.
    // It matches CHANNEL3_LIMIT on purpose: a row the model never read shows
    // an empty ledger, and the counts on screen then do not add up to the
    // number of rows. Judging every row costs about $0.035 instead of $0.018.
    rankLimit: Number(str('ERRAND_RANK_LIMIT', '24')),
  },

  limits: {
    // Per-IP ceiling on /api/errand, the only route that spends money. Six runs
    // an hour is more than a judge needs (each one takes ~20 s to read) and far
    // less than a loop needs to be worth writing. See http/ratelimit.ts.
    errandPerHour: Number(str('ERRAND_RATE_PER_HOUR', '6')),
    // Shared by everyone, so a caller who rotates X-Forwarded-For to dodge the
    // per-caller ceiling still meets a wall. Judging is 1-15 December and a
    // judge needs two or three runs, so 40 an hour is generous for real use.
    errandGlobalPerHour: Number(str('ERRAND_RATE_GLOBAL_PER_HOUR', '40')),
    errandWindowMs: Number(str('ERRAND_RATE_WINDOW_MS', String(60 * 60 * 1000))),
  },
} as const;

export const channel3Live = (): boolean => config.channel3.apiKey.length > 0;
export const paypalConfigured = (): boolean =>
  config.paypal.clientId.length > 0 && config.paypal.clientSecret.length > 0;
