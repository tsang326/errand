import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchWithDeadline } from './net.js';

/**
 * The live site once sat on "on it…" indefinitely because an upstream call had
 * no deadline and the instance was restarted mid-request. A stalled upstream
 * must become an error the page can show, not an open socket.
 */
test('an upstream that never answers becomes a 504, not a hang', async () => {
  const server = createServer(() => {
    /* accept the request and say nothing, for ever */
  });
  server.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as AddressInfo).port;

  try {
    const started = Date.now();
    await assert.rejects(
      () => fetchWithDeadline(`http://127.0.0.1:${port}/`, {}, 300, 'Stalled'),
      (err: Error & { status?: number; code?: string }) => {
        assert.equal(err.status, 504);
        assert.equal(err.code, 'upstream_timeout');
        assert.match(err.message, /Stalled did not answer/);
        return true;
      },
    );
    assert.ok(Date.now() - started < 5000, 'it gave up near the deadline, not much later');
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('a refused connection is reported as unreachable, not as a timeout', async () => {
  // Port 1 is reserved and nothing listens on it, so the connect fails at once.
  await assert.rejects(
    () => fetchWithDeadline('http://127.0.0.1:1/', {}, 5000, 'Nowhere'),
    (err: Error & { status?: number; code?: string }) => {
      assert.equal(err.code, 'upstream_unreachable');
      assert.equal(err.status, 502);
      return true;
    },
  );
});
