import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

/**
 * A device bucket, next to the address bucket, for the free allowance.
 *
 * The address alone was wrong in both directions. An office, a campus or a
 * mobile carrier puts hundreds of real people behind one address, and they
 * were sharing five errands a day between them. Meanwhile a bot does not need
 * to defeat the limit at all: it rotates addresses.
 *
 * So be honest about what this is for. A device id makes the free allowance
 * fair to people who share an address; it does not stop anyone who wants to
 * spam, because any client-side identity can be thrown away and asked for
 * again. What bounds a determined caller is money and the global ceiling, not
 * identity. The id is signed only so that it cannot be *forged* into someone
 * else's bucket — a caller who drops their cookie simply falls back to being
 * limited by address, which is where they started.
 */
const SECRET = randomUUID();
const COOKIE = 'errand_d';
const MAX_AGE_S = 30 * 24 * 60 * 60;

const sign = (id: string): string =>
  createHmac('sha256', SECRET).update(id).digest('base64url').slice(0, 27);

const valid = (id: string, sig: string): boolean => {
  const want = Buffer.from(sign(id));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
};

/** Reads the cookie header without a dependency: one header, two fields. */
function fromCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== COOKIE) continue;
    const [id, sig] = rest.join('=').split('.');
    if (id && sig && valid(id, sig)) return id;
  }
  return undefined;
}

/**
 * The device this request came from, issuing one if it has none. The cookie is
 * httpOnly: nothing in the page needs to read it, and a value the page cannot
 * read is one less thing a scraped copy of the app can replay.
 */
export function deviceId(req: Request, res: Response): string {
  const known = fromCookie(req.headers.cookie);
  if (known) return known;

  const id = randomUUID();
  res.cookie(COOKIE, `${id}.${sign(id)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.protocol === 'https',
    maxAge: MAX_AGE_S * 1000,
    path: '/',
  });
  return id;
}

/** Tests only: the signing used by deviceId, so a cookie can be built. */
export const cookieValueFor = (id: string): string => `${COOKIE}=${id}.${sign(id)}`;
export const forgedCookieFor = (id: string): string => `${COOKIE}=${id}.notasignature0000000000000`;
export const readDevice = fromCookie;
