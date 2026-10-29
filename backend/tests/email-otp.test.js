/**
 * Verification codes travel by email, not SMS.
 *
 * The point of the change is cost: a verification code is the highest-volume
 * message the platform sends, and every SMS has a per-send price. These tests
 * pin the behaviour that makes that switch safe - the code goes to the
 * address on the account, and nothing is sent to a phone number.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { pool, query, queryOne } from '../src/db/pool.js';

const PASSWORD = 'Testing@123';
const EMAIL = 'otp.subject@test.local';
const PHONE = '9555577001';

function request(port, method, path, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    if (token) headers.Authorization = 'Bearer ' + token;
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function cleanup() {
  await query('DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE email = $1)', [EMAIL]);
  await query('DELETE FROM users WHERE email = $1 OR phone = $2', [EMAIL, PHONE]);
  await query('DELETE FROM otp_codes WHERE destination = $1', [EMAIL]);
}

test('Verification codes go by email', async (t) => {
  await cleanup();
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  t.after(async () => {
    server.close();
    await cleanup();
    await pool.end();
  });

  let registration = null;

  await t.test('registration sends the code to the email address', async () => {
    const res = await request(port, 'POST', '/api/v1/auth/register', {
      body: { role: 'customer', fullName: 'Otp Subject', email: EMAIL, phone: PHONE, password: PASSWORD },
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.data.verification.channel, 'email');
    assert.equal(res.body.data.verification.destination, EMAIL);
    registration = res.body.data;
  });

  await t.test('registration without an email is rejected', async () => {
    const res = await request(port, 'POST', '/api/v1/auth/register', {
      body: { role: 'customer', fullName: 'No Email', phone: '9555577099', password: PASSWORD },
    });

    assert.equal(res.status, 422, 'email is the verification channel, so it is required');
    assert.ok(res.body.error.details.some((d) => d.field === 'body.email'));
  });

  await t.test('the code is stored against the email, never the phone number', async () => {
    const byEmail = await queryOne(
      'SELECT id, purpose FROM otp_codes WHERE destination = $1 ORDER BY created_at DESC LIMIT 1',
      [EMAIL],
    );
    const byPhone = await queryOne('SELECT id FROM otp_codes WHERE destination = $1', [PHONE]);

    assert.ok(byEmail, 'a code exists for the email address');
    assert.equal(byEmail.purpose, 'verify_email');
    assert.equal(byPhone, null, 'nothing was sent to the phone number');
  });

  await t.test('the delivery is recorded as an email notification', async () => {
    const row = await queryOne(
      `SELECT channel, status, event_type FROM notifications
        WHERE event_type = 'otp.verify_email'
        ORDER BY created_at DESC LIMIT 1`,
    );

    assert.equal(row.channel, 'email');
    assert.equal(row.status, 'sent');
  });

  await t.test('the emailed code confirms the account', async () => {
    const res = await request(port, 'POST', '/api/v1/auth/otp/verify', {
      body: { destination: EMAIL, code: registration.verification.devCode },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.emailVerified, true);
  });

  await t.test('a password reset emails the code even when the phone is given', async () => {
    const res = await request(port, 'POST', '/api/v1/auth/otp/send', {
      body: { destination: PHONE, purpose: 'reset_password' },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.channel, 'email');
    assert.equal(
      res.body.data.destination,
      EMAIL,
      'the account was found by phone, but the code went to the email on it',
    );
  });

  await t.test('a reset for an unknown account does not reveal that it is unknown', async () => {
    const res = await request(port, 'POST', '/api/v1/auth/otp/send', {
      body: { destination: 'nobody@test.local', purpose: 'reset_password' },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.sent, true);
  });

  await t.test('resending too quickly is refused', async () => {
    const res = await request(port, 'POST', '/api/v1/auth/otp/send', {
      body: { destination: EMAIL, purpose: 'reset_password' },
    });

    assert.equal(res.status, 429);
    assert.match(res.body.error.message, /wait/i);
  });

  await t.test('the code is echoed back only when nothing was actually emailed', async () => {
    const { codeCanBeEchoed } = await import('../src/services/email/mailer.js');
    const env = (await import('../src/config/env.js')).default;

    // The suite runs on the console driver, where no mail leaves the machine -
    // so a developer can complete a sign-up without an inbox.
    assert.equal(env.EMAIL_DRIVER, 'console');
    assert.equal(codeCanBeEchoed(), true);

    // The moment a real mail server is configured, the email IS the delivery.
    // Returning the code as well would hand it to anyone who can call the
    // endpoint, with no access to the inbox at all.
    const original = env.EMAIL_DRIVER;
    try {
      env.EMAIL_DRIVER = 'smtp';
      assert.equal(
        codeCanBeEchoed(),
        false,
        'with SMTP live the code must never come back in the API response',
      );
    } finally {
      env.EMAIL_DRIVER = original;
    }
  });

  await t.test('the rule is keyed on the mail driver, not on NODE_ENV', async () => {
    const { codeCanBeEchoed } = await import('../src/services/email/mailer.js');
    const env = (await import('../src/config/env.js')).default;

    // A staging box is not production, but its codes are just as real. Gating
    // on NODE_ENV alone would leak them there.
    const originalDriver = env.EMAIL_DRIVER;
    const originalProd = env.isProd;

    try {
      env.EMAIL_DRIVER = 'smtp';
      env.isProd = false;
      assert.equal(codeCanBeEchoed(), false, 'non-production with working email still withholds');
    } finally {
      env.EMAIL_DRIVER = originalDriver;
      env.isProd = originalProd;
    }
  });
});
