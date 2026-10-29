/**
 * Two-factor authentication as a requirement, not an option.
 *
 * `REQUIRE_ADMIN_2FA` is read once, when the configuration module is first
 * imported, so this file sets it before importing anything that reads it and
 * then loads the application dynamically. Node runs each test file in its own
 * process, so turning it on here does not reach the rest of the suite.
 *
 * What is being proved is narrow and important: an admin who has not enrolled
 * gets no session. Not a restricted session, not a session that happens to be
 * refused by the admin routes as they exist today - none at all. A test that
 * only checked the admin pages were blocked would keep passing on the day
 * somebody adds a route and forgets.
 */
process.env.REQUIRE_ADMIN_2FA = 'true';
process.env.TOTP_ENCRYPTION_KEY = process.env.TOTP_ENCRYPTION_KEY || 'test-totp-key-not-a-real-one';

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const { createApp } = await import('../src/app.js');
const { pool, query, queryOne } = await import('../src/db/pool.js');
const totp = await import('../src/services/totp.service.js');
const env = (await import('../src/config/env.js')).default;

const PASSWORD = 'Password@123';
const ADMIN = 'admin@servicesetu.in';

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
          body: data && /json/.test(res.headers['content-type'] ?? '') ? JSON.parse(data) : null,
        }),
      );
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('Admin accounts cannot sign in without two-factor', async (t) => {
  assert.equal(env.REQUIRE_ADMIN_2FA, true, 'this file is meaningless unless the rule is on');

  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const admin = await queryOne('SELECT id FROM users WHERE email = $1', [ADMIN]);

  const cleanUp = async () => {
    await query('DELETE FROM totp_recovery_codes WHERE user_id = $1', [admin.id]);
    await query('DELETE FROM user_totp WHERE user_id = $1', [admin.id]);
  };

  await cleanUp();

  t.after(async () => {
    // Leaving an enrolment behind would lock the seeded admin out of every
    // other suite, and out of the developer's own console.
    await cleanUp();
    server.close();
    await pool.end();
  });

  const signIn = (identifier = ADMIN) =>
    request(port, 'POST', '/api/v1/auth/login', { body: { identifier, password: PASSWORD } });

  let setupToken;
  let secret;

  await t.test('the right password alone yields no session', async () => {
    const res = await signIn();

    assert.equal(res.status, 200);
    assert.equal(res.body.data.twoFactorSetupRequired, true);
    assert.equal(res.body.data.accessToken, undefined, 'no access token');
    assert.equal(res.body.data.refreshToken, undefined, 'and no refresh token');

    setupToken = res.body.data.setupToken;
    secret = res.body.data.secret;
    assert.ok(setupToken && secret);
    assert.match(res.body.data.otpauthUri, /^otpauth:\/\/totp\//);
  });

  await t.test('the setup token opens nothing else', async () => {
    /**
     * The whole design rests on this.
     *
     * If the setup token were accepted as an access token anywhere, the
     * requirement would be decoration - the password alone would still reach
     * the console, just by a different door.
     */
    for (const [method, path] of [
      ['GET', '/api/v1/auth/me'],
      ['GET', '/api/v1/admin/people'],
      ['GET', '/api/v1/admin/backup/status'],
      ['POST', '/api/v1/admin/backup/run'],
      ['GET', '/api/v1/admin/settings'],
      ['GET', '/api/v1/auth/2fa'],
    ]) {
      const res = await request(port, method, path, { token: setupToken, body: {} });
      assert.equal(res.status, 401, path + ' must not accept the enrolment token');
    }
  });

  await t.test('a wrong code does not finish enrolment', async () => {
    const res = await request(port, 'POST', '/api/v1/auth/login/2fa/enrol', {
      body: { setupToken, code: '000000' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.data, undefined);

    const row = await queryOne('SELECT confirmed_at FROM user_totp WHERE user_id = $1', [admin.id]);
    assert.equal(row.confirmed_at, null, 'and 2FA is still not on');
  });

  await t.test('a correct code enrols and signs in, returning recovery codes', async () => {
    const res = await request(port, 'POST', '/api/v1/auth/login/2fa/enrol', {
      body: { setupToken, code: totp.codeFor(secret, totp.stepFor()) },
    });

    assert.equal(res.status, 200, JSON.stringify(res.body?.error ?? ''));
    assert.ok(res.body.data.accessToken, 'now, and only now, there is a session');
    assert.equal(res.body.data.user.role, 'admin');
    assert.equal(
      res.body.data.recoveryCodes.length,
      10,
      'and the way back in is handed over at the same moment - nobody returns for it later',
    );
  });

  await t.test('the next sign-in asks for a code, not for setup again', async () => {
    const res = await signIn();
    assert.equal(res.body.data.twoFactorRequired, true);
    assert.equal(res.body.data.twoFactorSetupRequired, undefined);
    assert.equal(res.body.data.accessToken, undefined);
  });

  await t.test('an admin session cannot outlive the requirement by refreshing', async () => {
    /**
     * The gap this closes: sessions that already existed when the rule was
     * switched on. Without a check on refresh, every one of them would renew
     * itself for thirty more days and the requirement would apply only to
     * people who happened to sign out.
     */
    const live = await request(port, 'POST', '/api/v1/auth/login/2fa', {
      body: {
        challengeToken: (await signIn()).body.data.challengeToken,
        code: totp.codeFor(secret, totp.stepFor() + 1),
      },
    });
    assert.equal(live.status, 200, JSON.stringify(live.body?.error ?? ''));

    // 2FA is removed behind their back, as if the account had never enrolled.
    await cleanUp();

    const refreshed = await request(port, 'POST', '/api/v1/auth/refresh', {
      body: { refreshToken: live.body.data.refreshToken },
    });
    assert.equal(refreshed.status, 403, 'the session must not be renewable');
    assert.match(refreshed.body.error.message, /two-factor/i);
  });

  await t.test('everyone else signs in exactly as before', async () => {
    // The requirement is for admins. If it reached customers, every person on
    // the platform would be stopped at a screen asking for an app they have
    // never heard of.
    for (const who of ['customer@servicesetu.in', 'plumber@servicesetu.in']) {
      const res = await request(port, 'POST', '/api/v1/auth/login', {
        body: { identifier: who, password: PASSWORD },
      });
      assert.equal(res.status, 200, who + ' signs in');
      assert.ok(res.body.data.accessToken, who + ' gets a session straight away');
      assert.equal(res.body.data.twoFactorSetupRequired, undefined);
    }
  });

  await t.test('a wrong password still reveals nothing', async () => {
    // The enrolment branch must sit behind the password check, not in front of
    // it: a response that said "set up 2FA" before the password was verified
    // would confirm which accounts are administrators.
    const res = await request(port, 'POST', '/api/v1/auth/login', {
      body: { identifier: ADMIN, password: 'not-the-password' },
    });

    assert.equal(res.status, 401);
    assert.equal(res.body.data, undefined);
    assert.ok(!/two-factor|setup/i.test(JSON.stringify(res.body)), 'and says nothing about 2FA');
  });
});
