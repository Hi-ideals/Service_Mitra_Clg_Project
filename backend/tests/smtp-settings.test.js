/**
 * Mail server settings, configured from the admin console.
 *
 * Three claims are worth testing, and they are all about the password.
 *
 * It must never come back out - not from this screen, not from the general
 * settings dump, not in an audit entry. It must not be readable in the
 * database, because that table is dumped into every backup and a backup can be
 * downloaded in one click. And settings that do not work must not be saved,
 * because email that silently stops is discovered by a customer, not by you.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { pool, query, queryOne } from '../src/db/pool.js';
import * as secrets from '../src/services/secrets.service.js';

const PASSWORD = 'Password@123';
const SECRET = 'a-mail-password-nobody-should-see';

function request(port, method, path, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = { 'Content-Type': 'application/json' };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    if (token) headers.Authorization = 'Bearer ' + token;

    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          raw: data,
          body: data && /json/.test(res.headers['content-type'] ?? '') ? JSON.parse(data) : null,
        }),
      );
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const signIn = (port, identifier) =>
  request(port, 'POST', '/api/v1/auth/login', { body: { identifier, password: PASSWORD } });

test('Mail server settings', async (t) => {
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  t.after(async () => {
    // Leaving a mail server configured would make every later suite try to
    // send real email.
    await query("DELETE FROM platform_settings WHERE key = 'smtp'");
    server.close();
    await pool.end();
  });

  const admin = { token: (await signIn(port, 'admin@servicesetu.in')).body.data.accessToken };
  const customer = { token: (await signIn(port, 'customer@servicesetu.in')).body.data.accessToken };

  await t.test('it starts off, and says what mail falls back to', async () => {
    const res = await request(port, 'GET', '/api/v1/admin/settings/smtp', admin);
    assert.equal(res.status, 200);

    const data = res.body.data;
    assert.equal(data.enabled, false);
    assert.equal(data.hasPassword, false);
    assert.ok(data.fallback, 'the screen can say where mail goes today');
  });

  await t.test('settings that do not connect are refused, not saved', async () => {
    /**
     * The failure this prevents: a typo in the host is saved, email stops,
     * and nothing says so until a customer reports a missing invoice. There
     * is no mail server on this port, so the connection cannot succeed.
     */
    const res = await request(port, 'PUT', '/api/v1/admin/settings/smtp', {
      ...admin,
      body: {
        enabled: true,
        host: '127.0.0.1',
        port: 2525,
        secure: false,
        username: 'someone@example.com',
        password: SECRET,
        fromName: 'ServiceMitra',
        fromEmail: 'no-reply@example.com',
      },
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'SMTP_CHECK_FAILED');
    assert.match(res.body.error.message, /did not work/i);

    const stored = await queryOne("SELECT value FROM platform_settings WHERE key = 'smtp'");
    assert.equal(stored, null, 'nothing was written');
  });

  await t.test('an unusable port is rejected before anything is attempted', async () => {
    const res = await request(port, 'PUT', '/api/v1/admin/settings/smtp', {
      ...admin,
      body: { enabled: true, host: 'smtp.example.com', port: 8080, secure: false, password: SECRET },
    });

    assert.equal(res.status, 422, 'the value never reaches the connection code');
  });

  await t.test('settings can be saved while switched off, without connecting', async () => {
    // So somebody can fill the form in now and switch it on when the mailbox
    // exists, rather than being blocked until everything is ready at once.
    const res = await request(port, 'PUT', '/api/v1/admin/settings/smtp', {
      ...admin,
      body: {
        enabled: false,
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        username: 'someone@example.com',
        password: SECRET,
        fromName: 'ServiceMitra',
        fromEmail: 'no-reply@example.com',
      },
    });

    assert.equal(res.status, 200, JSON.stringify(res.body?.error ?? ''));
    assert.equal(res.body.data.enabled, false);
    assert.equal(res.body.data.hasPassword, true, 'the password was stored');
  });

  await t.test('the password never comes back out', async () => {
    const screen = await request(port, 'GET', '/api/v1/admin/settings/smtp', admin);
    assert.ok(!screen.raw.includes(SECRET), 'not from its own screen');
    assert.equal(screen.body.data.hasPassword, true, 'only whether one exists');

    const all = await request(port, 'GET', '/api/v1/admin/settings', admin);
    assert.ok(!all.raw.includes(SECRET), 'not from the general settings');
    assert.ok(!/smtp/i.test(all.raw), 'which does not carry the mail settings at all');
  });

  await t.test('the password is not readable in the database', async () => {
    /**
     * The reason this is encrypted rather than merely hidden from the screen.
     * This table goes into every backup, and a backup can be downloaded from
     * the admin console by anyone who reaches it.
     */
    const row = await queryOne("SELECT value FROM platform_settings WHERE key = 'smtp'");
    const raw = JSON.stringify(row.value);

    assert.ok(!raw.includes(SECRET), 'the password itself is not in the column');
    assert.ok(row.value.password, 'something is stored');
    assert.equal(
      secrets.decrypt(row.value.password, 'smtp-password'),
      SECRET,
      'and it decrypts back with the right key',
    );
  });

  await t.test('a key for another purpose cannot read it', async () => {
    const row = await queryOne("SELECT value FROM platform_settings WHERE key = 'smtp'");
    assert.throws(
      () => secrets.decrypt(row.value.password, 'some-other-purpose'),
      'keys are derived per purpose, so one does not unlock another',
    );
  });

  await t.test('saving without a password keeps the stored one', async () => {
    // Otherwise changing a port would mean re-typing a credential that may
    // not be to hand - and people paste the wrong thing when hurried.
    const res = await request(port, 'PUT', '/api/v1/admin/settings/smtp', {
      ...admin,
      body: { enabled: false, host: 'smtp.example.com', port: 465, secure: true, username: 'someone@example.com' },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.port, 465);
    assert.equal(res.body.data.hasPassword, true, 'still there');

    const row = await queryOne("SELECT value FROM platform_settings WHERE key = 'smtp'");
    assert.equal(secrets.decrypt(row.value.password, 'smtp-password'), SECRET, 'and unchanged');
  });

  await t.test('the change is recorded, without the password', async () => {
    const row = await queryOne(
      `SELECT before_state, after_state FROM admin_audit_log
        WHERE action = 'settings.smtp_updated' ORDER BY created_at DESC LIMIT 1`,
    );

    assert.ok(row, 'changing where mail comes from is not an unrecorded event');
    assert.ok(
      !JSON.stringify(row).includes(SECRET),
      'and the audit trail does not become a place the password can be read',
    );
  });

  await t.test('a test email cannot be sent while it is off', async () => {
    const res = await request(port, 'POST', '/api/v1/admin/settings/smtp/test', admin);
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /before sending a test/i);
  });

  await t.test('no one but an admin can see or change any of it', async () => {
    assert.equal((await request(port, 'GET', '/api/v1/admin/settings/smtp', customer)).status, 403);
    assert.equal(
      (await request(port, 'PUT', '/api/v1/admin/settings/smtp', { ...customer, body: { enabled: false } })).status,
      403,
    );
    assert.equal((await request(port, 'POST', '/api/v1/admin/settings/smtp/test', customer)).status, 403);

    assert.equal((await request(port, 'GET', '/api/v1/admin/settings/smtp')).status, 401);
  });
});
