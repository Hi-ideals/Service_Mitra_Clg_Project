/**
 * Phase 12 tests: background jobs, generated documentation and the security
 * posture of the running app.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { pool, queryOne } from '../src/db/pool.js';
import { registerJobs, status, runNow } from '../src/jobs/index.js';
import * as tasks from '../src/jobs/tasks.js';
import env from '../src/config/env.js';

/**
 * The upload root the sweep itself uses.
 *
 * Hardcoding 'uploads' here only worked while the test and development
 * environments shared one directory - which is exactly the arrangement that
 * left real KYC documents sitting next to files the suite created.
 */
const UPLOAD_ROOT = path.resolve(env.UPLOAD_DIR, 'private');

function get(port, pathname, token) {
  return new Promise((resolve, reject) => {
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    http.get({ host: '127.0.0.1', port, path: pathname, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () =>
        resolve({ status: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : null }));
    }).on('error', reject);
  });
}

test('Phase 12: hardening and delivery', async (t) => {
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  t.after(async () => {
    server.close();
    await pool.end();
  });

  // ---------- background jobs ----------

  await t.test('every scheduled job is registered with an interval', async () => {
    registerJobs();
    const s = status();
    const names = s.jobs.map((j) => j.name);

    for (const expected of [
      'expire-requests', 'close-dispute-windows', 'nudge-stalled-jobs',
      'retry-notifications', 'reconcile-payments', 'release-payouts', 'clean-orphaned-files',
    ]) {
      assert.ok(names.includes(expected), expected + ' is registered');
    }

    assert.ok(s.jobs.every((j) => j.everyMs > 0), 'each job has an interval');
    assert.equal(s.running, false, 'the scheduler does not start itself in tests');
  });

  await t.test('jobs are idempotent - running twice does nothing extra', async () => {
    const first = await runNow('expire-requests');
    const second = await runNow('expire-requests');
    assert.equal(typeof first.expired, 'number');
    assert.equal(second.expired, 0, 'the second run finds nothing left to do');
  });

  await t.test('closing dispute windows releases held earnings', async () => {
    const result = await tasks.closeDisputeWindows();
    assert.equal(typeof result.released, 'number');

    const stillHeld = await queryOne(
      `SELECT COUNT(*)::int AS held FROM provider_earnings e
        WHERE e.payout_id IS NULL AND e.available_at > NOW()
          AND e.booking_id IN (
            SELECT id FROM bookings
             WHERE status = 'completed' AND dispute_window_ends_at <= NOW())`,
    );
    assert.equal(stillHeld.held, 0, 'nothing stays held past its window');
  });

  await t.test('payment reconciliation reports rather than guesses', async () => {
    const result = await tasks.reconcilePayments();
    assert.equal(typeof result.flagged, 'number');
    // Deliberately does not mutate: a missed webhook needs the gateway's
    // authoritative answer, not an assumption made locally.
  });

  await t.test('orphaned KYC files are swept and referenced ones survive', async () => {
    const root = path.join(UPLOAD_ROOT, 'kyc');
    await fs.mkdir(root, { recursive: true });

    const orphan = path.join(root, 'orphan-test.png');
    await fs.writeFile(orphan, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const old = new Date(Date.now() - 3 * 86400000);
    await fs.utimes(orphan, old, old);

    const referenced = await queryOne('SELECT storage_key FROM kyc_documents LIMIT 1');

    const result = await tasks.cleanOrphanedFiles();
    assert.ok(result.removed >= 1, 'the orphan was removed');
    await assert.rejects(() => fs.access(orphan), 'the orphan is gone');

    if (referenced) {
      // Throws if the sweep deleted a live document.
      await fs.access(path.join(UPLOAD_ROOT, referenced.storage_key));
    }
  });

  await t.test('a recent file is never swept, even when orphaned', async () => {
    const fresh = path.join(UPLOAD_ROOT, 'kyc', 'fresh-upload.png');
    await fs.writeFile(fresh, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await tasks.cleanOrphanedFiles();
    await fs.access(fresh);

    await fs.rm(fresh, { force: true });
  });

  // ---------- generated documentation ----------

  await t.test('the API documents itself from the live router', async () => {
    const res = await get(port, '/api/v1/docs');
    assert.equal(res.status, 200);
    assert.ok(res.body.endpointCount > 90, 'the whole surface is discovered');
    assert.ok(res.body.areas.length >= 15);

    const auth = res.body.areas.find((a) => a.name === 'Authentication');
    assert.ok(auth.endpoints.includes('POST /api/v1/auth/login'));

    const bookings = res.body.areas.find((a) => a.name === 'Bookings and jobs');
    assert.ok(
      bookings.endpoints.some((e) => e.includes(':id')),
      'route parameters are named, not left as capture groups',
    );

    assert.ok(res.body.conventions.money.includes('minor units'));
  });

  await t.test('a documented endpoint really exists', async () => {
    const res = await get(port, '/api/v1/docs');
    const documented = res.body.areas.flatMap((a) => a.endpoints);
    assert.ok(documented.includes('GET /health'));

    const health = await get(port, '/health');
    assert.equal(health.status, 200);
  });

  // ---------- security posture ----------

  await t.test('security headers are present and the stack is not advertised', async () => {
    const res = await get(port, '/health');
    assert.equal(res.headers['x-powered-by'], undefined);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.ok(res.headers['x-request-id']);
  });

  await t.test('readiness reports the scheduler without failing on it', async () => {
    const res = await get(port, '/health/ready');
    assert.equal(res.status, 200);
    assert.ok(res.body.checks.scheduler, 'scheduler state is visible');
    assert.equal(res.body.checks.database.ok, true);
    // A failing sweep must not take an instance out of the load balancer.
    assert.equal(res.body.success, true);
  });

  await t.test('an unknown route returns the standard envelope, not a stack trace', async () => {
    const res = await get(port, '/api/v1/definitely-not-a-route');
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.debug, undefined, 'no internals leak');
    assert.ok(res.body.requestId);
  });

  await t.test('credentials are configured for redaction in logs', async () => {
    const source = await fs.readFile('src/config/logger.js', 'utf8');
    for (const secret of ['password', 'passwordHash', 'token', 'refreshToken', 'otp', 'authorization']) {
      assert.ok(source.toLowerCase().includes(secret.toLowerCase()), secret + ' is redacted');
    }
  });
});
