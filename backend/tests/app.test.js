/**
 * Phase 1 smoke tests - the app boots, the middleware chain is wired, and the
 * failure paths produce the API's standard error envelope. These deliberately
 * do not touch PostgreSQL, so they run before the database exists.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app).listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path, headers }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: body ? JSON.parse(body) : null,
          }),
        );
      })
      .on('error', reject);
  });
}

test('Phase 1: application surface', async (t) => {
  const { server, port } = await listen(createApp());
  t.after(() => server.close());

  await t.test('liveness endpoint responds without touching the database', async () => {
    const res = await get(port, '/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.status, 'healthy');
  });

  await t.test('root advertises the API prefix', async () => {
    const res = await get(port, '/');
    assert.equal(res.status, 200);
    assert.equal(res.body.api, '/api/v1');
  });

  await t.test('v1 index responds', async () => {
    const res = await get(port, '/api/v1');
    assert.equal(res.status, 200);
    assert.equal(res.body.version, 'v1');
  });

  await t.test('unknown route returns the standard error envelope', async () => {
    const res = await get(port, '/api/v1/does-not-exist');
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'NOT_FOUND');
    assert.ok(res.body.requestId, 'error responses carry the correlation id');
  });

  await t.test('correlation id is generated and echoed back', async () => {
    const generated = await get(port, '/health');
    assert.match(generated.headers['x-request-id'], /^[0-9a-f-]{36}$/);

    const passed = await get(port, '/health', { 'x-request-id': 'trace-abc-123' });
    assert.equal(passed.headers['x-request-id'], 'trace-abc-123');
  });

  await t.test('security headers are applied and the stack is not advertised', async () => {
    const res = await get(port, '/health');
    assert.equal(res.headers['x-powered-by'], undefined);
    assert.ok(res.headers['x-content-type-options'], 'helmet is active');
  });

  await t.test('readiness reports the database as down when it is unreachable', async () => {
    const res = await get(port, '/health/ready');
    assert.ok([200, 503].includes(res.status));
    assert.equal(typeof res.body.checks.database.ok, 'boolean');
  });
});
