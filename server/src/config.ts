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
    // Price tracking is still on v0, so it cannot hang off baseUrl.
    historyUrl: str(
      'CHANNEL3_HISTORY_URL',
      'https://api.trychannel3.com/v0/price-tracking/history',
    ),
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

  /**
   * What a pass costs and what it buys. The price is set here and nowhere near
   * the client: the goods cart used to send PayPal a unit price the browser had
   * chosen, which is only safe while the account is in sandbox. A pass is
   * Errand's own product, so the server is the only thing that may price it.
   *
   * Four cents of model and index spend per errand, so twenty-five of them cost
   * about a dollar to serve. Three dollars covers that, the Render instance, and
   * the ones that fail and are not charged for.
   */
  pass: {
    runs: Number(str('PASS_RUNS', '25')),
    price: str('PASS_PRICE', '3.00'),
    currency: str('PASS_CURRENCY', 'USD'),
  },
  limits: {
    // Per-IP ceiling on /api/errand, the only route that spends money. Thirty
    // runs an hour is $1 of model spend from one caller: more than a judge
    // trying every example sentence will reach (each run takes ~20 s to read),
    // and little enough that a loop from a browser tab stops being worth
    // writing. Six was the first figure here and was tighter than a judge
    // exploring the thing deserves. See http/ratelimit.ts.
    errandPerHour: Number(str('ERRAND_RATE_PER_HOUR', '30')),
    // Shared by everyone, so a caller who rotates X-Forwarded-For to dodge the
    // per-caller ceiling still meets a wall. It has to sit well above the
    // per-IP figure or one caller holds the whole pool and the second judge of
    // the hour is turned away: 90 is three callers at their own ceiling, about
    // $3 an hour, and the project's spend cap is what bounds the day.
    errandGlobalPerHour: Number(str('ERRAND_RATE_GLOBAL_PER_HOUR', '90')),
    errandWindowMs: Number(str('ERRAND_RATE_WINDOW_MS', String(60 * 60 * 1000))),
    // Errands an address gets without paying. A judge has to be able to type a
    // sentence and see the thing work without reaching for a wallet, and five
    // runs is every example sentence on the page plus two of their own. Past
    // that the caller is exploring on my money, which is what the pass is for.
    freeRunsPerHour: Number(str('ERRAND_FREE_RUNS_PER_HOUR', '5')),
  },
} as const;

export const channel3Live = (): boolean => config.channel3.apiKey.length > 0;
export const paypalConfigured = (): boolean =>
  config.paypal.clientId.length > 0 && config.paypal.clientSecret.length > 0;
