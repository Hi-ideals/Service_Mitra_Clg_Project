/**
 * Phase 3 tests: registration, sign-in, session rotation and the authorisation
 * gates, exercised over real HTTP against the real database. Test accounts are
 * removed afterwards.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db/pool.js';
import { registerAndConfirm } from './helpers/signup.js';

const PHONE_CUSTOMER = '9555500001';
const PHONE_PROVIDER = '9555500002';
// Verification codes travel by email now, so every test account needs one.
const EMAIL_CUSTOMER = 't.customer.auth@test.local';
const EMAIL_PROVIDER = 't.provider.auth@test.local';
const PASSWORD = 'Testing@123';
const ALL_TEST_PHONES = [PHONE_CUSTOMER, PHONE_PROVIDER, '9555500009', '9555500010'];

function request(port, method, path, { body, token, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    if (token) headers.Authorization = 'Bearer ' + token;
    if (cookie) headers.Cookie = cookie;

    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          cookies: res.headers['set-cookie'] || [],
          body: data ? JSON.parse(data) : null,
        }),
      );
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function cleanup() {
  await query('DELETE FROM users WHERE phone = ANY($1::text[])', [ALL_TEST_PHONES]);
  await query('DELETE FROM otp_codes WHERE destination = ANY($1::text[])', [ALL_TEST_PHONES]);
  await query('DELETE FROM otp_codes WHERE destination = ANY($1::text[])', [
    [EMAIL_CUSTOMER, EMAIL_PROVIDER],
  ]);
}

test('Phase 3: authentication and role flow', async (t) => {
  await cleanup();
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  t.after(async () => {
    server.close();
    await cleanup();
    await pool.end();
  });

  let customer = {};
  let provider = {};

  await t.test('registering creates the account but issues no session', async () => {
    const res = await request(port, 'POST', '/api/v1/auth/register', {
      body: { role: 'customer', fullName: 'Test Customer', email: EMAIL_CUSTOMER, phone: PHONE_CUSTOMER, password: PASSWORD },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.user.role, 'customer');

    // The whole point. Registration used to hand over a working session and
    // treat the code as a formality, so an invented email and an invented
    // phone number produced an account that could book a real professional.
    assert.equal(res.body.data.accessToken, undefined, 'no access token until the code is confirmed');
    assert.equal(res.body.data.refreshToken, undefined, 'and no refresh token');
    assert.ok(!res.cookies.some((c) => c.startsWith('sst_refresh=')), 'and no session cookie');

    assert.ok(res.body.data.verification.devCode, 'confirmation code issued');
    assert.equal(res.body.data.verification.channel, 'email', 'codes go by email, not SMS');
    assert.equal(res.body.data.verification.destination, EMAIL_CUSTOMER);
    assert.equal(res.body.data.user.emailVerified, false);
    customer = res.body.data;
  });

  await t.test('the password alone cannot sign in an unconfirmed account', async () => {
    // Stopping registration alone would achieve nothing: the password was
    // chosen by the same person a moment ago, so they would simply sign in.
    const res = await request(port, 'POST', '/api/v1/auth/login', {
      body: { identifier: PHONE_CUSTOMER, password: PASSWORD },
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'ACCOUNT_UNVERIFIED');
    assert.equal(res.body.data, undefined, 'no session of any kind');
  });

  await t.test('an unconfirmed account does not hold its email address', async () => {
    /**
     * One mistyped domain, or one accidental refresh, must not reserve a real
     * person's own address against an account nobody can ever sign into.
     * Registering again replaces it and sends a new code.
     */
    const again = await request(port, 'POST', '/api/v1/auth/register', {
      body: { role: 'customer', fullName: 'Test Customer', email: EMAIL_CUSTOMER, phone: PHONE_CUSTOMER, password: PASSWORD },
    });

    assert.equal(again.status, 201, 'the same details can be used again');
    assert.notEqual(
      again.body.data.verification.devCode,
      customer.verification.devCode,
      'and a fresh code is sent, not the old one',
    );
    customer = again.body.data;
  });

  await t.test('no password material is ever returned', async () => {
    const serialised = JSON.stringify(customer);
    assert.ok(!serialised.includes(PASSWORD), 'plaintext password absent');
    assert.ok(!serialised.includes('password_hash'), 'hash absent');
  });

  await t.test('confirming the emailed code is what signs the person in', async () => {
    const res = await request(port, 'POST', '/api/v1/auth/otp/verify', {
      body: { destination: EMAIL_CUSTOMER, code: customer.verification.devCode },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.emailVerified, true);

    assert.ok(res.body.data.accessToken, 'the session arrives here, and only here');
    assert.ok(res.body.data.refreshToken);
    assert.ok(
      res.cookies.some((c) => c.startsWith('sst_refresh=')),
      'with the refresh cookie set, as a sign-in would',
    );

    customer = { ...customer, ...res.body.data };
  });

  await t.test('the refresh token is set as an HttpOnly cookie', async () => {
    const res = await request(port, 'POST', '/api/v1/auth/login', {
      body: { identifier: PHONE_CUSTOMER, password: PASSWORD },
    });
    assert.equal(res.status, 200);
    const cookie = res.cookies.find((c) => c.startsWith('sst_refresh='));
    assert.ok(cookie, 'refresh cookie present');
    assert.match(cookie, /HttpOnly/i, 'page scripts cannot read it');
  });

  await t.test('registering the same phone twice is rejected', async () => {
    const res = await request(port, 'POST', '/api/v1/auth/register', {
      body: { role: 'customer', fullName: 'Duplicate', email: 'dupe@test.local', phone: PHONE_CUSTOMER, password: PASSWORD },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'CONFLICT');
  });

  await t.test('a wrong password does not reveal whether the account exists', async () => {
    const wrongPassword = await request(port, 'POST', '/api/v1/auth/login', {
      body: { identifier: PHONE_CUSTOMER, password: 'Wrong@12345' },
    });
    const noAccount = await request(port, 'POST', '/api/v1/auth/login', {
      body: { identifier: '9555599999', password: 'Wrong@12345' },
    });
    assert.equal(wrongPassword.status, 401);
    assert.equal(noAccount.status, 401);
    assert.equal(wrongPassword.body.error.message, noAccount.body.error.message);
  });

  await t.test('a weak password is rejected with field-level detail', async () => {
    const res = await request(port, 'POST', '/api/v1/auth/register', {
      body: { role: 'customer', fullName: 'Weak', email: 'weak@test.local', phone: '9555500009', password: 'password' },
    });
    assert.equal(res.status, 422);
    assert.ok(res.body.error.details.some((d) => d.field === 'body.password'));
  });

  await t.test('a wrong code is rejected', async () => {
    const res = await request(port, 'POST', '/api/v1/auth/otp/verify', {
      body: { destination: EMAIL_CUSTOMER, code: '000000' },
    });
    assert.equal(res.status, 400);
  });

  await t.test('/me requires a token', async () => {
    const anon = await request(port, 'GET', '/api/v1/auth/me');
    assert.equal(anon.status, 401);
    assert.equal(anon.body.error.code, 'UNAUTHENTICATED');

    const signedIn = await request(port, 'GET', '/api/v1/auth/me', { token: customer.accessToken });
    assert.equal(signedIn.status, 200);
    assert.equal(signedIn.body.data.phone, PHONE_CUSTOMER);
  });

  await t.test('a tampered token is rejected', async () => {
    const res = await request(port, 'GET', '/api/v1/auth/me', {
      token: customer.accessToken.slice(0, -4) + 'aaaa',
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'TOKEN_INVALID');
  });

  await t.test('a provider registers unverified, with a profile created alongside', async () => {
    const res = await registerAndConfirm(request, port, {
      role: 'provider', fullName: 'Test Provider', email: EMAIL_PROVIDER, phone: PHONE_PROVIDER, password: PASSWORD,
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.user.role, 'provider');
    // Two different meanings of "verified" meet here. The contact details are
    // now confirmed - that is what the code proved - but the provider is still
    // waiting on an admin to look at their KYC, which is what makes them
    // bookable.
    assert.equal(res.body.data.user.emailVerified, true);
    assert.equal(res.body.data.user.verificationStatus, 'unsubmitted');
    assert.ok(res.body.data.user.providerId, 'provider profile created');
    provider = res.body.data;
  });

  await t.test('an admin account cannot be self-registered', async () => {
    const res = await request(port, 'POST', '/api/v1/auth/register', {
      body: { role: 'admin', fullName: 'Sneaky', email: 'sneaky@test.local', phone: '9555500010', password: PASSWORD },
    });
    assert.equal(res.status, 422, 'admin is not an accepted role on the public endpoint');
  });

  await t.test('refresh rotates the token and a replay is rejected', async () => {
    const first = await request(port, 'POST', '/api/v1/auth/refresh', {
      body: { refreshToken: provider.refreshToken },
    });
    assert.equal(first.status, 200);
    assert.notEqual(first.body.data.refreshToken, provider.refreshToken, 'token rotated');

    const replay = await request(port, 'POST', '/api/v1/auth/refresh', {
      body: { refreshToken: provider.refreshToken },
    });
    assert.equal(replay.status, 401, 'a reused refresh token is rejected');
  });

  await t.test('changing the password revokes every other session', async () => {
    const login = await request(port, 'POST', '/api/v1/auth/login', {
      body: { identifier: PHONE_CUSTOMER, password: PASSWORD },
    });
    const changed = await request(port, 'POST', '/api/v1/auth/password/change', {
      token: login.body.data.accessToken,
      body: { currentPassword: PASSWORD, newPassword: 'Changed@456' },
    });
    assert.equal(changed.status, 200);
    assert.ok(changed.body.data.sessionsRevoked >= 1);

    const stale = await request(port, 'POST', '/api/v1/auth/refresh', {
      body: { refreshToken: login.body.data.refreshToken },
    });
    assert.equal(stale.status, 401, 'older sessions no longer refresh');

    const withNew = await request(port, 'POST', '/api/v1/auth/login', {
      body: { identifier: PHONE_CUSTOMER, password: 'Changed@456' },
    });
    assert.equal(withNew.status, 200, 'the new password works');
  });
});
