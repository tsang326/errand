import { buildApp } from './http/api.js';
import { config, channel3Live, paypalConfigured } from './config.js';

const app = buildApp();
app.listen(config.port, () => {
  console.log(
    `errand on :${config.port} — products: ${channel3Live() ? 'channel3' : 'fixtures'}, ` +
      `paypal: ${paypalConfigured() ? (config.paypal.sandbox ? 'sandbox' : 'LIVE') : 'off'}, ` +
      `model: ${config.openai.apiKey ? config.openai.model : 'none'}`,
  );
});
