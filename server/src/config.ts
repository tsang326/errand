import 'dotenv/config';

const str = (name: string, fallback = ''): string => process.env[name]?.trim() || fallback;

export const config = {
  port: Number(str('PORT', '8787')),
  db: str('ERRAND_DB', './errand.db'),

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
} as const;

export const channel3Live = (): boolean => config.channel3.apiKey.length > 0;
export const paypalConfigured = (): boolean =>
  config.paypal.clientId.length > 0 && config.paypal.clientSecret.length > 0;
