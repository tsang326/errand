import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { buildApp } from './api.js';

/**
 * The reopen path (GET) once returned an errand without `ranking`, because the
 * POST handler added that field to the response but not to what it stored. The
 * web app read `errand.ranking.source` and white-screened. Both routes must
 * hand back the same object.
 */
test('an errand reopened by id has the same shape the run returned', async () => {
  const server = buildApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const created = await fetch(`${base}/api/errand`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sentence: 'a desk lamp under 40 dollars' }),
    });
    assert.equal(created.status, 200);
    const run = (await created.json()) as { id: string; ranking?: unknown };
    assert.ok(run.ranking, 'the run response carries ranking');

    const reopened = await fetch(`${base}/api/errand/${run.id}`);
    assert.equal(reopened.status, 200);
    assert.deepEqual(await reopened.json(), run);
  } finally {
    server.close();
  }
});

test('an id the server never held is a 404, not an empty errand', async () => {
  const server = buildApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const res = await fetch(`${base}/api/errand/not-a-real-id`);
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});
