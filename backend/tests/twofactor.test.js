/**
 * Two-factor authentication.
 *
 * The algorithm is checked against the test vectors published in RFC 6238
 * itself, because an implementation that is subtly wrong still produces
 * six plausible digits and only fails against real authenticator apps - in
 * production, on the day somebody needs to sign in.
 *
 * Everything else here guards a property that, if it broke, would turn 2FA
 * into decoration: that the password alone is no longer enough, that a code
 * cannot be used twice, that turning it off is as protected as turning it on,
 * and that the secret is not sitting in the database in readable form where a
 * stolen backup would hand it over.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { pool, query, queryOne } from '../src/db/pool.js';
import * as totp from '../src/services/totp.service.js';

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

// ---------------------------------------------------------------- the algorithm

test('TOTP matches the RFC 6238 test vectors', () => {
  // Appendix B of the RFC, SHA-1 rows. The secret there is the ASCII string
  // "12345678901234567890"; the published codes are eight digits.
  const secret = totp.toBase32(Buffer.from('12345678901234567890', 'ascii'));

  const vectors = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];

  for (const [seconds, expected] of vectors) {
    assert.equal(
      totp.codeFor(secret, Math.floor(seconds / 30), 8),
      expected,
      'T=' + seconds + ' must produce the code the RFC publishes',
    );
  }
});

test('a code is accepted either side of now, but not beyond', () => {
  const secret = totp.generateSecret();
  const now = Date.now();
  const step = totp.stepFor(now);

  assert.equal(totp.verify(secret, totp.codeFor(secret, step), { at: now }), step);
  assert.equal(
    totp.verify(secret, totp.codeFor(secret, step - 1), { at: now }),
    step - 1,
    'the previous half-minute still works, for a clock that drifts',
  );
  assert.equal(
    totp.verify(secret, totp.codeFor(secret, step + 1), { at: now }),
    step + 1,
    'and the next one, for the same reason',
  );
  assert.equal(
    totp.verify(secret, totp.codeFor(secret, step - 2), { at: now }),
    null,
    'a minute ago is too far - the window is not open indefinitely',
  );
});

test('a code already used is refused', () => {
  const secret = totp.generateSecret();
  const now = Date.now();
  const step = totp.stepFor(now);
  const code = totp.codeFor(secret, step);

  assert.equal(totp.verify(secret, code, { at: now }), step);
  assert.equal(
    totp.verify(secret, code, { at: now, after: step }),
    null,
    'the same code inside its own thirty seconds is spent, not valid again',
  );
});

test('malformed input is rejected rather than throwing', () => {
  const secret = totp.generateSecret();
  for (const bad of ['', null, undefined, 'abcdef', '12345', '1234567', '12 34 56']) {
    assert.equal(totp.verify(secret, bad), null, JSON.stringify(bad) + ' is not a code');
  }
});

test('a secret survives encryption, and tampering is detected', () => {
  const secret = totp.generateSecret();
  const stored = totp.encryptSecret(secret);

  assert.notEqual(stored, secret, 'what is stored is not the secret itself');
  assert.ok(!stored.includes(secret), 'and does not contain it');
  assert.equal(totp.decryptSecret(stored), secret);

  // AES-GCM: a changed byte fails the tag rather than decrypting to rubbish.
  const [iv, tag, payload] = stored.split('.');
  const flipped = Buffer.from(payload, 'base64');
  flipped[0] ^= 0xff;
  assert.throws(() => totp.decryptSecret([iv, tag, flipped.toString('base64')].join('.')));
});

// ---------------------------------------------------------------- the flow

test('Two-factor sign-in', async (t) => {
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const admin = await queryOne('SELECT id FROM users WHERE email = $1', [ADMIN]);

  t.after(async () => {
    // Leaving 2FA on the seeded admin would break every later suite that signs
    // in as them - and leave the developer locked out of their own dev console.
    await query('DELETE FROM totp_recovery_codes WHERE user_id = $1', [admin.id]);
    await query('DELETE FROM user_totp WHERE user_id = $1', [admin.id]);
    // The pool is closed once, by the last suite in this file.
    server.close();
  });

  const signIn = (identifier = ADMIN, password = PASSWORD) =>
    request(port, 'POST', '/api/v1/auth/login', { body: { identifier, password } });

  let session = (await signIn()).body.data;
  let secret;
  let recoveryCodes;

  await t.test('before setup, a password alone signs the admin in', async () => {
    assert.ok(session.accessToken, 'this is the state 2FA is meant to change');
  });

  await t.test('setup needs the password again, not just a session', async () => {
    const wrong = await request(port, 'POST', '/api/v1/auth/2fa/setup', {
      token: session.accessToken, body: { password: 'not-the-password' },
    });
    assert.equal(wrong.status, 401, 'a stolen session must not be enough to enrol a new device');

    const res = await request(port, 'POST', '/api/v1/auth/2fa/setup', {
      token: session.accessToken, body: { password: PASSWORD },
    });
    assert.equal(res.status, 200);

    secret = res.body.data.secret;
    assert.ok(/^[A-Z2-7]{32}$/.test(secret), 'a base32 secret an authenticator app can read');
    // The issuer carries the environment outside production, so the label is
    // matched loosely - what matters is that it names the product and the
    // account, not the exact suffix.
    assert.match(res.body.data.otpauthUri, /^otpauth:\/\/totp\/ServiceMitra[^:]*:/);
    assert.ok(
      res.body.data.otpauthUri.includes(encodeURIComponent('admin@servicesetu.in')),
      'and names the account, so one entry can be told from another in the app',
    );
    assert.ok(res.body.data.otpauthUri.includes('secret=' + secret));
  });

  await t.test('setup alone does not switch it on', async () => {
    const res = await signIn();
    assert.ok(
      res.body.data.accessToken,
      'scanning a QR code and closing the tab must not lock the account',
    );

    const status = await request(port, 'GET', '/api/v1/auth/2fa', { token: session.accessToken });
    assert.equal(status.body.data.enabled, false);
    assert.equal(status.body.data.pending, true);
  });

  await t.test('a wrong code does not switch it on either', async () => {
    const res = await request(port, 'POST', '/api/v1/auth/2fa/enable', {
      token: session.accessToken, body: { code: '000000' },
    });
    assert.equal(res.status, 400);

    const status = await request(port, 'GET', '/api/v1/auth/2fa', { token: session.accessToken });
    assert.equal(status.body.data.enabled, false);
  });

  await t.test('a code from the app switches it on and returns recovery codes', async () => {
    const res = await request(port, 'POST', '/api/v1/auth/2fa/enable', {
      token: session.accessToken,
      body: { code: totp.codeFor(secret, totp.stepFor()) },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body?.error ?? ''));

    recoveryCodes = res.body.data.recoveryCodes;
    assert.equal(recoveryCodes.length, 10, 'there is a way back in');
    for (const code of recoveryCodes) assert.match(code, /^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    assert.equal(new Set(recoveryCodes).size, 10, 'and they are all different');
  });

  await t.test('the secret is not readable in the database', async () => {
    // The point of encrypting it: a stolen backup must not hand over the
    // second factor along with the password hashes.
    const row = await queryOne('SELECT secret_encrypted FROM user_totp WHERE user_id = $1', [admin.id]);
    assert.ok(!row.secret_encrypted.includes(secret), 'the secret itself is not in the column');
    assert.notEqual(row.secret_encrypted, secret);

    const codes = await query('SELECT code_hash FROM totp_recovery_codes WHERE user_id = $1', [admin.id]);
    for (const row2 of codes.rows) {
      assert.ok(
        !recoveryCodes.some((c) => row2.code_hash.includes(c.replace('-', ''))),
        'recovery codes are stored hashed, not in readable form',
      );
    }
  });

  await t.test('now the password alone is not enough', async () => {
    const res = await signIn();
    assert.equal(res.status, 200);
    assert.equal(res.body.data.twoFactorRequired, true);
    assert.ok(res.body.data.challengeToken);
    assert.equal(res.body.data.accessToken, undefined, 'no session is issued by the password alone');
    assert.equal(res.body.data.refreshToken, undefined);
  });

  await t.test('the challenge token is not an access token', async () => {
    const { challengeToken } = (await signIn()).body.data;

    // Different audience, so presenting it to an ordinary endpoint fails. If
    // this ever passed, the password alone would still be enough - just by a
    // different route.
    const res = await request(port, 'GET', '/api/v1/auth/me', { token: challengeToken });
    assert.equal(res.status, 401);
  });

  await t.test('a wrong code does not complete the sign-in', async () => {
    const { challengeToken } = (await signIn()).body.data;

    const res = await request(port, 'POST', '/api/v1/auth/login/2fa', {
      body: { challengeToken, code: '000000' },
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.data, undefined);
  });

  await t.test('the right code completes it', async () => {
    const { challengeToken } = (await signIn()).body.data;

    // The NEXT step's code, not this one's. Switching 2FA on consumed the
    // current step, so reusing it here would be refused - correctly, by the
    // replay guard. The step after is inside the acceptance window and unused,
    // which is exactly what an authenticator shows a moment later.
    const res = await request(port, 'POST', '/api/v1/auth/login/2fa', {
      body: { challengeToken, code: totp.codeFor(secret, totp.stepFor() + 1) },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body?.error ?? ''));
    assert.ok(res.body.data.accessToken, 'now there is a session');
    assert.equal(res.body.data.user.email, ADMIN);
    assert.equal(res.body.data.usedRecoveryCode, false);

    session = res.body.data;
  });

  await t.test('the same code cannot be used twice, even simultaneously', async () => {
    /**
     * Fired together, on purpose.
     *
     * Sequentially, the in-memory check against the recorded step catches the
     * replay on its own. Two requests arriving at once both read the same
     * recorded step before either writes, so that check passes for both and
     * only the conditional UPDATE in the database can separate them. This is
     * the race an attacker with a shoulder-surfed code actually runs, and
     * testing it sequentially proves the wrong guard.
     */
    // Clears the recorded step first. The tests above have each consumed one,
    // and once the recorded step reaches the top of the acceptance window no
    // code is valid until the clock moves on - which would make this test
    // measure the passage of time rather than the race it is about.
    await query('UPDATE user_totp SET last_step = NULL WHERE user_id = $1', [admin.id]);

    const code = totp.codeFor(secret, totp.stepFor());

    const [a, b] = await Promise.all([
      signIn().then((r) => r.body.data.challengeToken),
      signIn().then((r) => r.body.data.challengeToken),
    ]);

    const [first, second] = await Promise.all([
      request(port, 'POST', '/api/v1/auth/login/2fa', { body: { challengeToken: a, code } }),
      request(port, 'POST', '/api/v1/auth/login/2fa', { body: { challengeToken: b, code } }),
    ]);

    const accepted = [first, second].filter((r) => r.status === 200);
    assert.equal(
      accepted.length,
      1,
      'exactly one of two simultaneous uses of one code may succeed (' +
        first.status + ', ' + second.status + ')',
    );
  });

  await t.test('a recovery code works, once', async () => {
    const code = recoveryCodes[0];

    const first = await request(port, 'POST', '/api/v1/auth/login/2fa', {
      body: { challengeToken: (await signIn()).body.data.challengeToken, code },
    });
    assert.equal(first.status, 200, 'the way back in when the phone is gone');
    assert.equal(first.body.data.usedRecoveryCode, true);
    assert.equal(first.body.data.recoveryCodesRemaining, 9, 'and the person is told how many are left');

    const again = await request(port, 'POST', '/api/v1/auth/login/2fa', {
      body: { challengeToken: (await signIn()).body.data.challengeToken, code },
    });
    assert.equal(again.status, 401, 'single use means single use');
  });

  await t.test('a recovery code from another account is refused', async () => {
    // Not merely "an unused code": one that is genuinely valid, for somebody
    // else. A check that looks up the code without scoping it to the account
    // would pass every other test in this file and fail only here.
    const other = await queryOne('SELECT id FROM users WHERE email = $1', ['customer@servicesetu.in']);
    const stolen = totp.generateRecoveryCodes(1)[0];
    await query(
      'INSERT INTO totp_recovery_codes (user_id, code_hash) VALUES ($1, $2)',
      [other.id, totp.hashRecoveryCode(stolen)],
    );

    try {
      const res = await request(port, 'POST', '/api/v1/auth/login/2fa', {
        body: { challengeToken: (await signIn()).body.data.challengeToken, code: stolen },
      });
      assert.equal(res.status, 401, "another account's recovery code must not open this one");
    } finally {
      await query('DELETE FROM totp_recovery_codes WHERE user_id = $1', [other.id]);
    }
  });

  await t.test('turning it off needs the password and a code', async () => {
    const live = (await request(port, 'POST', '/api/v1/auth/login/2fa', {
      body: {
        challengeToken: (await signIn()).body.data.challengeToken,
        code: recoveryCodes[1],
      },
    })).body.data;

    // A session alone is not enough - otherwise stealing one would let an
    // attacker strip the second factor and keep the account.
    const noPassword = await request(port, 'POST', '/api/v1/auth/2fa/disable', {
      token: live.accessToken, body: { password: 'wrong', code: recoveryCodes[2] },
    });
    assert.equal(noPassword.status, 401);

    const noCode = await request(port, 'POST', '/api/v1/auth/2fa/disable', {
      token: live.accessToken, body: { password: PASSWORD, code: '000000' },
    });
    assert.equal(noCode.status, 401);

    const still = await request(port, 'GET', '/api/v1/auth/2fa', { token: live.accessToken });
    assert.equal(still.body.data.enabled, true, 'and nothing changed');

    const res = await request(port, 'POST', '/api/v1/auth/2fa/disable', {
      token: live.accessToken,
      body: { password: PASSWORD, code: recoveryCodes[2] },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body?.error ?? ''));

    const after = await signIn();
    assert.ok(after.body.data.accessToken, 'the password alone signs in again');
    assert.equal(after.body.data.twoFactorRequired, undefined);
  });

  await t.test('nothing is left behind when it is turned off', async () => {
    const row = await queryOne('SELECT 1 AS x FROM user_totp WHERE user_id = $1', [admin.id]);
    assert.equal(row, null, 'the secret is deleted, not merely marked inactive');

    const codes = await queryOne(
      'SELECT COUNT(*)::int AS n FROM totp_recovery_codes WHERE user_id = $1', [admin.id],
    );
    assert.equal(codes.n, 0, 'and so are the recovery codes');
  });
});

test('Two-factor is per account, not per platform', async (t) => {
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  t.after(async () => {
    server.close();
    await pool.end();
  });

  await t.test('an account without it signs in exactly as before', async () => {
    // The regression that would matter most: turning this on for one admin
    // must not add a step for every customer on the platform.
    const res = await request(port, 'POST', '/api/v1/auth/login', {
      body: { identifier: 'customer@servicesetu.in', password: PASSWORD },
    });

    assert.equal(res.status, 200);
    assert.ok(res.body.data.accessToken);
    assert.equal(res.body.data.twoFactorRequired, undefined);
  });

  await t.test('the 2FA endpoints need a session at all', async () => {
    for (const [method, path] of [
      ['GET', '/api/v1/auth/2fa'],
      ['POST', '/api/v1/auth/2fa/setup'],
      ['POST', '/api/v1/auth/2fa/enable'],
      ['POST', '/api/v1/auth/2fa/disable'],
    ]) {
      const res = await request(port, method, path, { body: {} });
      assert.equal(res.status, 401, path + ' must require a signed-in account');
    }
  });
});
