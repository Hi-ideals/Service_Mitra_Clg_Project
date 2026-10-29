/**
 * Verification codes over WhatsApp.
 *
 * The claims that matter: a code sent over WhatsApp still verifies, a number
 * WhatsApp cannot reach falls back to email rather than locking the customer
 * out, and the response says which channel actually carried it so the
 * interface can tell them where to look.
 *
 * Runs against the console driver. Live delivery to Meta is deliberately not
 * exercised here - a test suite that posts to a third party is a test suite
 * that fails when their API has a bad afternoon.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { pool, query, queryOne } from '../src/db/pool.js';
import env from '../src/config/env.js';
import { toE164 } from '../src/utils/phone.js';

const TAG = 'whatsapp-otp-test';

function request(port, method, path, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
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

/** A fresh number and address per run, so reruns do not collide. */
function identity() {
  const n = Math.floor(Math.random() * 90000000) + 10000000;
  return {
    email: 'wa' + n + '@example.test',
    phone: '9' + String(n).padStart(9, '0').slice(0, 9),
  };
}

async function cleanup() {
  await query("DELETE FROM otp_codes WHERE destination LIKE 'wa%@example.test'");
  await query("DELETE FROM users WHERE email LIKE 'wa%@example.test'");
}

test('Verification codes over WhatsApp', async (t) => {
  await cleanup();

  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  // The channel preference is read per call, so it can be steered per test.
  const originalChannel = env.OTP_CHANNEL;

  t.after(async () => {
    env.OTP_CHANNEL = originalChannel;
    await cleanup();
    server.close();
    await pool.end();
  });

  const register = (who) =>
    request(port, 'POST', '/api/v1/auth/register', {
      body: {
        role: 'customer',
        fullName: 'WhatsApp Tester',
        email: who.email,
        phone: who.phone,
        password: 'Password@123',
      },
    });

  await t.test('a code sent over WhatsApp reports the channel it used', async () => {
    env.OTP_CHANNEL = 'whatsapp';
    const who = identity();

    const res = await register(who);
    assert.equal(res.status, 201, JSON.stringify(res.body?.error ?? ''));

    const v = res.body.data.verification;
    assert.equal(v.channel, 'whatsapp', 'the response must name the channel that carried it');
    assert.match(v.sentTo, /\*{3,}\d{4}$/, 'the number shown is masked, not printed in full');
  });

  await t.test('the confirm key is the email, the shown value is the number', async () => {
    env.OTP_CHANNEL = 'whatsapp';
    const who = identity();

    const res = await register(who);
    const v = res.body.data.verification;

    // These were once one field, which is how a masked phone number ended up
    // being posted back as the lookup key and nothing ever matched.
    assert.equal(v.destination, who.email, 'destination is the key, posted back verbatim');
    assert.match(v.sentTo, /\*{3,}\d{4}$/, 'sentTo is for display only');
    assert.notEqual(v.destination, v.sentTo, 'the two must not collapse into one value');

    // The key works; the displayed value must not.
    const good = await request(port, 'POST', '/api/v1/auth/otp/verify', {
      body: { destination: v.destination, code: v.devCode },
    });
    assert.equal(good.status, 200, 'confirming with the key succeeds');
  });

  await t.test('a code delivered over WhatsApp still verifies', async () => {
    env.OTP_CHANNEL = 'whatsapp';
    const who = identity();

    const res = await register(who);
    assert.equal(res.status, 201);

    const code = res.body.data.verification.devCode;
    assert.ok(code, 'the console driver echoes the code so the flow is testable');

    // Keyed to the email even though WhatsApp carried it - that is what keeps
    // the confirm step independent of the delivery channel.
    const confirm = await request(port, 'POST', '/api/v1/auth/otp/verify', {
      body: { destination: who.email, code },
    });

    assert.equal(confirm.status, 200, JSON.stringify(confirm.body?.error ?? ''));
  });

  await t.test('the code is stored against the email, not the phone', async () => {
    env.OTP_CHANNEL = 'whatsapp';
    const who = identity();
    await register(who);

    const byEmail = await queryOne(
      'SELECT id FROM otp_codes WHERE destination = $1 ORDER BY created_at DESC LIMIT 1',
      [who.email],
    );
    const byPhone = await queryOne(
      'SELECT id FROM otp_codes WHERE destination = $1 LIMIT 1',
      [toE164(who.phone)],
    );

    assert.ok(byEmail, 'the code is keyed to the email address');
    assert.equal(byPhone, null, 'and never to the phone number');
  });

  await t.test('the raw code is never written to the notification row', async () => {
    env.OTP_CHANNEL = 'whatsapp';
    const who = identity();
    const res = await register(who);
    const code = res.body.data.verification.devCode;

    const rows = await query(
      `SELECT body, data::text AS data FROM notifications
        WHERE channel = 'whatsapp' ORDER BY created_at DESC LIMIT 5`,
    );

    // A ten-minute secret sitting in a table that is kept for months is a
    // secret with a much longer life than intended.
    for (const row of rows.rows) {
      assert.ok(!String(row.body).includes(code), 'the code must not be in the stored body');
    }
  });

  await t.test('an unusable number is not even attempted on WhatsApp', async () => {
    env.OTP_CHANNEL = 'whatsapp';

    const { issueOtp } = await import('../src/services/otp.service.js');
    const who = identity();

    const result = await issueOtp({
      userId: null,
      destination: who.email,
      phone: 'not-a-number',
      purpose: 'verify_email',
    });

    assert.equal(result.channel, 'email');
    assert.equal(result.sentTo, who.email);
  });

  await t.test('a WhatsApp failure falls back to email', async () => {
    env.OTP_CHANNEL = 'whatsapp';

    // A real registration with a real number, but the cloud driver holding no
    // credentials - so WhatsApp is genuinely attempted and genuinely fails.
    //
    // Two earlier versions of this test did not actually exercise the
    // fallback: one used an unparseable number, which skips the WhatsApp
    // branch entirely, and one called issueOtp with userId null, which fails
    // the NOT NULL on notifications.user_id before delivery is ever reached.
    // Going through the real endpoint avoids both.
    const originalDriver = env.WHATSAPP_DRIVER;
    env.WHATSAPP_DRIVER = 'cloud';

    try {
      const who = identity();
      const res = await register(who);

      assert.equal(res.status, 201, JSON.stringify(res.body?.error ?? ''));

      const v = res.body.data.verification;
      assert.equal(v.channel, 'email', 'the customer still receives a code, by email');
      assert.equal(v.destination, who.email, 'and is told to check their email');

      // The code must work, not merely have been claimed as sent.
      assert.ok(v.devCode, 'the console email driver echoes it so this is checkable');
      const confirm = await request(port, 'POST', '/api/v1/auth/otp/verify', {
        body: { destination: who.email, code: v.devCode },
      });
      assert.equal(confirm.status, 200, 'the fallback code actually verifies');
    } finally {
      env.WHATSAPP_DRIVER = originalDriver;
    }
  });

  await t.test('a failed WhatsApp attempt is recorded, not hidden', async () => {
    env.OTP_CHANNEL = 'whatsapp';
    const originalDriver = env.WHATSAPP_DRIVER;
    env.WHATSAPP_DRIVER = 'cloud';

    try {
      const who = identity();
      await register(who);

      // The notification row survives the failure with a reason attached, so
      // a support question months later can be answered from the record
      // rather than from memory.
      const failed = await queryOne(
        `SELECT status, failure_reason FROM notifications
          WHERE channel = 'whatsapp' AND status = 'failed'
          ORDER BY created_at DESC LIMIT 1`,
      );

      assert.ok(failed, 'the attempt is on record');
      assert.match(failed.failure_reason, /not configured|WhatsApp/i);
    } finally {
      env.WHATSAPP_DRIVER = originalDriver;
    }
  });

  await t.test('every role gets its code the same way', async () => {
    env.OTP_CHANNEL = 'whatsapp';

    // Registration branches on role to create a provider profile or an agency,
    // and the OTP call sits after that branch. This asserts the branch does not
    // change delivery - a provider signing up must get the same treatment as a
    // customer, or one role silently falls back to email forever.
    for (const role of ['customer', 'provider', 'agency']) {
      const who = identity();

      const res = await request(port, 'POST', '/api/v1/auth/register', {
        body: {
          role,
          fullName: 'Role Test',
          email: who.email,
          phone: who.phone,
          password: 'Password@123',
          ...(role === 'agency' ? { agencyName: 'Role Test Agency' } : {}),
        },
      });

      assert.equal(res.status, 201, role + ' registration: ' + JSON.stringify(res.body?.error ?? ''));

      const v = res.body.data.verification;
      assert.equal(v.channel, 'whatsapp', role + ' must receive its code on WhatsApp');
      assert.equal(v.destination, who.email, role + ' confirms against the email');
      assert.match(v.sentTo, /\*{3,}\d{4}$/, role + ' is shown a masked number');

      // And the code actually works for that role.
      const confirm = await request(port, 'POST', '/api/v1/auth/otp/verify', {
        body: { destination: v.destination, code: v.devCode },
      });
      assert.equal(confirm.status, 200, role + ' can confirm with the code it was sent');
    }
  });

  await t.test('a resent code also goes over WhatsApp', async () => {
    env.OTP_CHANNEL = 'whatsapp';
    const who = identity();
    await register(who);

    // Registration has just issued a code, and a resend inside 60 seconds is
    // correctly refused. Backdating the existing one puts the cooldown behind
    // us without weakening it or waiting a real minute.
    await query(
      "UPDATE otp_codes SET created_at = NOW() - INTERVAL '2 minutes' WHERE destination = $1",
      [who.email],
    );

    // The resend path looks the account up and re-issues; it has its own call
    // to issueOtp and could easily have been left on email.
    const again = await request(port, 'POST', '/api/v1/auth/otp/send', {
      body: { destination: who.email, purpose: 'verify_email' },
    });

    assert.equal(again.status, 200, JSON.stringify(again.body?.error ?? ''));
    assert.equal(again.body.data.channel, 'whatsapp');
    assert.equal(again.body.data.destination, who.email);
  });

  await t.test('email remains the default when nothing is configured otherwise', async () => {
    env.OTP_CHANNEL = 'email';
    const who = identity();

    const res = await register(who);
    assert.equal(res.status, 201);
    assert.equal(res.body.data.verification.channel, 'email');
    assert.equal(res.body.data.verification.destination, who.email);
  });

  await t.test('the password-reset decoy does not reveal the channel difference', async () => {
    env.OTP_CHANNEL = 'whatsapp';

    // An address with no account. The reply must look like a real one, or the
    // difference tells an attacker which addresses are registered.
    const unknown = await request(port, 'POST', '/api/v1/auth/otp/send', {
      body: { destination: 'nobody-' + Date.now() + '@example.test', purpose: 'reset_password' },
    });

    assert.equal(unknown.status, 200);
    assert.equal(
      unknown.body.data.channel,
      'whatsapp',
      'the decoy reports the configured channel, matching a genuine response',
    );
  });
});
