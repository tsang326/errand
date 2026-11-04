import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cookieValueFor, forgedCookieFor, readDevice } from './device.js';

test('a device id this server signed is read back', () => {
  assert.equal(readDevice(cookieValueFor('abc-123')), 'abc-123');
});

test('a forged id is not read, so nobody can sit in another device’s bucket', () => {
  assert.equal(readDevice(forgedCookieFor('abc-123')), undefined);
});

test('an id edited after signing is rejected', () => {
  const cookie = cookieValueFor('abc-123').replace('abc-123', 'abc-124');
  assert.equal(readDevice(cookie), undefined);
});

test('the cookie is found among others, and absence is not an error', () => {
  assert.equal(readDevice(`ab=1; ${cookieValueFor('x-9')}; zz=2`), 'x-9');
  assert.equal(readDevice('ab=1; zz=2'), undefined);
  assert.equal(readDevice(undefined), undefined);
});
