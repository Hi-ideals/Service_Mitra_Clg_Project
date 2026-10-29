/**
 * The algorithm a token is verified with is chosen by this server, never by
 * the token.
 *
 * Every attack in this file works the same way: take a value the server is
 * willing to hand out or that an attacker can read, and present it signed
 * differently, hoping the verifier reads `alg` out of the header and obliges.
 * Each one must be refused.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import env from '../src/config/env.js';

const PASSWORD = 'Password@123';

function request(port, path, token) {
  return new Promise((resolve, reject) => {
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    req.end();
  });
}

function post(port, path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1', port, method: 'POST', path,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(JSON.parse(data)));
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

test('A token cannot choose how it is verified', async (t) => {
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  t.after(async () => {
    server.close();
    await pool.end();
  });

  const customer = (await post(port, '/api/v1/auth/login', {
    identifier: 'customer@servicesetu.in', password: PASSWORD,
  })).data;

  // The shape of a real token from this server, used as the template for
  // every forgery below.
  const real = jwt.decode(customer.accessToken);

  await t.test('the honest token still works', async () => {
    // Without this the rest of the file could pass against a server that
    // rejects everything, including what it just issued.
    const res = await request(port, '/api/v1/auth/me', customer.accessToken);
    assert.equal(res.status, 200);
  });

  await t.test('alg: none is refused', async () => {
    const forged = b64({ alg: 'none', typ: 'JWT' }) + '.' + b64(real) + '.';
    const res = await request(port, '/api/v1/auth/me', forged);
    assert.equal(res.status, 401, 'an unsigned token must never be accepted');
  });

  await t.test('an unexpected HMAC size is refused', async () => {
    // Correctly signed, with the right secret, in the wrong algorithm. Before
    // the algorithm was pinned this was accepted: the library read HS512 out
    // of the header and verified against it.
    const forged = jwt.sign(
      { sub: real.sub, role: real.role, status: real.status },
      env.JWT_ACCESS_SECRET,
      { algorithm: 'HS512', audience: 'servicesetu:access', issuer: 'servicesetu', expiresIn: '5m' },
    );

    const res = await request(port, '/api/v1/auth/me', forged);
    assert.equal(res.status, 401, 'only the algorithm this server signs with is accepted');
  });

  await t.test('a token signed with the wrong secret is refused', async () => {
    const forged = jwt.sign(
      { sub: real.sub, role: 'admin', status: 'active' },
      crypto.randomBytes(32).toString('hex'),
      { algorithm: 'HS256', audience: 'servicesetu:access', issuer: 'servicesetu', expiresIn: '5m' },
    );

    const res = await request(port, '/api/v1/auth/me', forged);
    assert.equal(res.status, 401);
  });

  await t.test('a token claiming to be an admin is only as good as its signature', async () => {
    // The payload is rewritten, the signature left alone - the oldest trick
    // there is, and the one people assume a library handles for them.
    const [header, , signature] = customer.accessToken.split('.');
    const escalated = [header, b64({ ...real, role: 'admin' }), signature].join('.');

    const res = await request(port, '/api/v1/admin/people/summary', escalated);
    assert.equal(res.status, 401, 'an edited payload invalidates the signature');
  });

  await t.test('a token for a different audience is refused', async () => {
    // The 2FA challenge token is a real token this server signs and hands to
    // anyone who knows a password. Its audience is what stops it being used
    // as a session.
    const forged = jwt.sign(
      { sub: real.sub, stage: 'totp' },
      env.JWT_ACCESS_SECRET,
      { algorithm: 'HS256', audience: 'servicesetu:2fa', issuer: 'servicesetu', expiresIn: '5m' },
    );

    const res = await request(port, '/api/v1/auth/me', forged);
    assert.equal(res.status, 401);
  });

  await t.test('a token from another issuer is refused', async () => {
    const forged = jwt.sign(
      { sub: real.sub, role: real.role, status: 'active' },
      env.JWT_ACCESS_SECRET,
      { algorithm: 'HS256', audience: 'servicesetu:access', issuer: 'somewhere-else', expiresIn: '5m' },
    );

    const res = await request(port, '/api/v1/auth/me', forged);
    assert.equal(res.status, 401);
  });

  await t.test('an expired token is refused', async () => {
    const forged = jwt.sign(
      { sub: real.sub, role: real.role, status: 'active' },
      env.JWT_ACCESS_SECRET,
      { algorithm: 'HS256', audience: 'servicesetu:access', issuer: 'servicesetu', expiresIn: '-1s' },
    );

    const res = await request(port, '/api/v1/auth/me', forged);
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'TOKEN_EXPIRED');
  });
});
