import { config, paypalConfigured } from '../config.js';
import { DEADLINE_MS, fetchWithDeadline } from '../net.js';

const BASE = () =>
  config.paypal.sandbox
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';

type Token = { value: string; expiresAt: number };
let cached: Token | undefined;

/**
 * PayPal's OAuth token is good for hours, so it is cached in the process. The
 * expiry is shortened by a minute: a token that dies mid-request turns into a
 * 401 on the capture call, which is the one call in this app that must not be
 * retried blindly, because a retried capture can take the money twice.
 */
async function accessToken(): Promise<string> {
  if (!paypalConfigured()) {
    throw new Error('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are not set');
  }
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  const basic = Buffer.from(
    `${config.paypal.clientId}:${config.paypal.clientSecret}`,
  ).toString('base64');

  const res = await fetchWithDeadline(
    `${BASE()}/v1/oauth2/token`,
    {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    },
    DEADLINE_MS.paypal,
    'PayPal',
  );
  if (!res.ok) {
    throw new Error(`paypal token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error('paypal token response had no access_token');

  cached = {
    value: json.access_token,
    expiresAt: now + Math.max(0, (json.expires_in ?? 3600) - 60) * 1000,
  };
  return cached.value;
}

export type PayPalError = Error & { status: number; debugId?: string; body?: unknown };

/**
 * One request to PayPal. `requestId` becomes PayPal-Request-Id, their
 * idempotency header: the same id replays the first answer instead of creating
 * a second order or taking a second capture.
 */
export async function paypalRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  requestId?: string,
): Promise<T> {
  const token = await accessToken();
  const res = await fetchWithDeadline(
    `${BASE()}${path}`,
    {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(requestId ? { 'paypal-request-id': requestId } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    DEADLINE_MS.paypal,
    'PayPal',
  );

  const text = await res.text();
  const parsed: unknown = text.length > 0 ? JSON.parse(text) : {};

  if (!res.ok) {
    const err = new Error(
      `paypal ${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`,
    ) as PayPalError;
    err.status = res.status;
    // PayPal's debug id is what their support asks for first; losing it means
    // a failed sandbox order cannot be traced afterwards.
    const dbg = res.headers.get('paypal-debug-id');
    if (dbg) err.debugId = dbg;
    err.body = parsed;
    throw err;
  }
  return parsed as T;
}

/** Only for tests: forget the cached token. */
export const resetTokenCache = (): void => {
  cached = undefined;
};
