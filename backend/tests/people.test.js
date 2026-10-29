/**
 * The admin people directory.
 *
 * Counting is the easy half. The claims worth testing are the dangerous ones:
 * only an admin may reach any of it, suspending an account actually stops the
 * person signing in, and an admin cannot lock themselves out.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { pool, query, queryOne } from '../src/db/pool.js';

const PASSWORD = 'Password@123';

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
          headers: res.headers,
          raw: data,
          body: /json/.test(res.headers['content-type'] ?? '') && data ? JSON.parse(data) : null,
        }),
      );
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const signIn = async (port, identifier) =>
  (await request(port, 'POST', '/api/v1/auth/login', { body: { identifier, password: PASSWORD } }))
    .body.data;

test('Admin people directory', async (t) => {
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const admin = await signIn(port, 'admin@servicesetu.in');
  const aAuth = { token: admin.accessToken };
  const customer = await signIn(port, 'customer@servicesetu.in');

  // Restored in `after` whatever happens: leaving a seeded account suspended
  // would fail every later suite that signs in as them.
  const victim = await queryOne(
    "SELECT id, status FROM users WHERE email = 'carpenter@servicesetu.in'",
  );

  t.after(async () => {
    // Both halves. Suspending also takes a provider offline, and restoring
    // only the account status left the seeded carpenter active but not
    // accepting bookings - which every later suite that expects the seeded
    // providers to be discoverable then failed on.
    await query("UPDATE users SET status = 'active' WHERE id = $1", [victim.id]);
    await query(
      'UPDATE provider_profiles SET is_accepting_bookings = TRUE WHERE user_id = $1',
      [victim.id],
    );
    server.close();
    await pool.end();
  });

  await t.test('the summary counts each role and what is verified', async () => {
    const res = await request(port, 'GET', '/api/v1/admin/people/summary', aAuth);
    assert.equal(res.status, 200);

    const s = res.body.data;
    assert.ok(s.total > 0);
    assert.ok(s.providers.total >= 4, 'the seeded providers are counted');
    assert.ok(s.providers.verified >= 1, 'and the approved ones separately');
    assert.ok(s.providers.verified <= s.providers.total, 'verified is a subset, not a parallel count');
    assert.ok(s.agencies.verified <= s.agencies.total);
    assert.equal(typeof s.customers, 'number');
    assert.equal(typeof s.suspended, 'number');
  });

  await t.test('the counts agree with the database', async () => {
    const res = await request(port, 'GET', '/api/v1/admin/people/summary', aAuth);
    const row = await queryOne(
      `SELECT COUNT(*) FILTER (WHERE role = 'provider')::int AS providers,
              COUNT(*) FILTER (WHERE role = 'customer')::int AS customers
         FROM users WHERE deleted_at IS NULL`,
    );
    assert.equal(res.body.data.providers.total, row.providers);
    assert.equal(res.body.data.customers, row.customers);
  });

  await t.test('the list can be filtered by role', async () => {
    const res = await request(port, 'GET', '/api/v1/admin/people?role=provider&limit=50', aAuth);
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length > 0);
    assert.ok(
      res.body.data.every((p) => p.role === 'provider'),
      'a role filter that lets other roles through is worse than none',
    );
  });

  await t.test('a search matches a name, an email or a business', async () => {
    const res = await request(port, 'GET', '/api/v1/admin/people?search=carpenter', aAuth);
    assert.equal(res.status, 200);
    assert.ok(
      res.body.data.some((p) => /carpenter/i.test(p.email ?? '')),
      'the seeded carpenter is found by their email',
    );
  });

  await t.test('a customer row reports no verification rather than a false one', async () => {
    const res = await request(port, 'GET', '/api/v1/admin/people?role=customer&limit=5', aAuth);
    const row = res.body.data[0];
    assert.equal(row.verification, null, 'customers are not verified or unverified, they just are');
    assert.equal(row.isVerified, false);
    assert.equal(row.jobsCompleted, null, 'and have no job count to confuse with zero');
  });

  await t.test('the export is a CSV with a dated filename', async () => {
    const res = await request(port, 'GET', '/api/v1/admin/people?format=csv&role=provider', aAuth);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/csv/);
    assert.match(res.headers['content-disposition'], /attachment; filename="servicemitra-people-\d{4}-\d{2}-\d{2}\.csv"/);
    assert.match(res.raw, /Name,Role,Business,Email/, 'the header row names the columns');
    assert.ok(res.raw.split('\r\n').length > 2, 'and there are rows under it');
  });

  await t.test('only an admin can reach any of it', async () => {
    const cAuth = { token: customer.accessToken };
    for (const path of ['/api/v1/admin/people', '/api/v1/admin/people/summary']) {
      const res = await request(port, 'GET', path, cAuth);
      assert.equal(res.status, 403, path + ' must be admin-only');
    }

    const write = await request(port, 'PATCH', '/api/v1/admin/people/' + victim.id + '/status', {
      ...cAuth, body: { status: 'suspended' },
    });
    assert.equal(write.status, 403, 'and a customer certainly cannot suspend anyone');
  });

  await t.test('suspending an account stops that person signing in', async () => {
    const res = await request(port, 'PATCH', '/api/v1/admin/people/' + victim.id + '/status', {
      ...aAuth, body: { status: 'suspended', reason: 'Testing the control' },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body?.error ?? ''));
    assert.equal(res.body.data.status, 'suspended');

    const login = await request(port, 'POST', '/api/v1/auth/login', {
      body: { identifier: 'carpenter@servicesetu.in', password: PASSWORD },
    });
    assert.notEqual(login.status, 200, 'a suspended account must not be able to sign in');

    // And taken offline, not merely barred from signing in - a provider left
    // accepting bookings would keep appearing in search.
    const profile = await queryOne(
      'SELECT is_accepting_bookings FROM provider_profiles WHERE user_id = $1',
      [victim.id],
    );
    assert.equal(profile.is_accepting_bookings, false);
  });

  await t.test('restoring lets them back in', async () => {
    const res = await request(port, 'PATCH', '/api/v1/admin/people/' + victim.id + '/status', {
      ...aAuth, body: { status: 'active' },
    });
    assert.equal(res.status, 200);

    const login = await request(port, 'POST', '/api/v1/auth/login', {
      body: { identifier: 'carpenter@servicesetu.in', password: PASSWORD },
    });
    assert.equal(login.status, 200, 'and they can sign in again');
  });

  await t.test('an admin account cannot be suspended at all', async () => {
    /**
     * Not merely your own.
     *
     * Only an admin can reach this endpoint, so admin suspension can only ever
     * lock admins out of the console that unlocks accounts, and there is no way
     * back from that inside the app.
     *
     * A second admin is made for the attempt rather than looked for: this
     * database has one, and a test that quietly skips when it cannot find a
     * subject asserts nothing while looking like it passed.
     */
    const stand_in = await queryOne(
      "SELECT id, role FROM users WHERE email = 'electrician@servicesetu.in'",
    );
    await query("UPDATE users SET role = 'admin' WHERE id = $1", [stand_in.id]);

    try {
      const res = await request(port, 'PATCH', '/api/v1/admin/people/' + stand_in.id + '/status', {
        ...aAuth, body: { status: 'suspended' },
      });
      assert.equal(res.status, 400);
      assert.match(res.body.error.message, /admin/i);

      const still = await queryOne('SELECT status FROM users WHERE id = $1', [stand_in.id]);
      assert.equal(still.status, 'active', 'and nothing changed');
    } finally {
      // Status and bookability too, not just the role. If the guard ever
      // regresses, the suspension here succeeds - and a stand-in left
      // suspended takes the seeded electrician out of every later suite.
      await query(
        "UPDATE users SET role = $2::user_role, status = 'active' WHERE id = $1",
        [stand_in.id, stand_in.role],
      );
      await query(
        'UPDATE provider_profiles SET is_accepting_bookings = TRUE WHERE user_id = $1',
        [stand_in.id],
      );
    }
  });

  await t.test('an admin cannot suspend themselves', async () => {
    const res = await request(port, 'PATCH', '/api/v1/admin/people/' + admin.user.id + '/status', {
      ...aAuth, body: { status: 'suspended' },
    });
    assert.equal(res.status, 400, 'there is no way back from locking yourself out');

    const still = await queryOne('SELECT status FROM users WHERE id = $1', [admin.user.id]);
    assert.equal(still.status, 'active');
  });

  await t.test('suspending an account that does not exist says so', async () => {
    const res = await request(
      port, 'PATCH', '/api/v1/admin/people/00000000-0000-0000-0000-000000000000/status',
      { ...aAuth, body: { status: 'suspended' } },
    );
    assert.equal(res.status, 404);
  });

  await t.test('the action is written to the audit log', async () => {
    const row = await queryOne(
      `SELECT action, entity_type, reason FROM admin_audit_log
        WHERE entity_id = $1 AND action = 'account.suspended'
        ORDER BY created_at DESC LIMIT 1`,
      [victim.id],
    );
    assert.ok(row, 'suspending somebody is not something that should happen unrecorded');
    assert.equal(row.entity_type, 'user');
    assert.equal(row.reason, 'Testing the control');
  });
});
