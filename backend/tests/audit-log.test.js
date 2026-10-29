/**
 * The audit trail, as an admin reads it.
 *
 * Admin routes skip the ownership checks that protect every other endpoint,
 * so this trail is what stands in their place. The claims worth testing are
 * that it is complete, that it is readable, that it cannot be edited through
 * the API, and that only an admin can see it - it names who did what, and
 * that is not a list for customers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { pool, query, queryOne } from '../src/db/pool.js';
import { changes, label } from '../src/modules/admin/audit.service.js';

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

// ------------------------------------------------------------ pure functions

test('a change list names only what moved', () => {
  const before = { host: 'old.example.com', port: 587, fromName: 'ServiceMitra' };
  const after = { host: 'new.example.com', port: 587, fromName: 'ServiceMitra' };

  // The value of this screen over reading two blocks of JSON by eye.
  assert.deepEqual(changes(before, after), [
    { field: 'host', from: 'old.example.com', to: 'new.example.com' },
  ]);
});

test('a field that appears or disappears counts as a change', () => {
  assert.deepEqual(changes({}, { reason: 'Fraud' }), [
    { field: 'reason', from: null, to: 'Fraud' },
  ]);
  assert.deepEqual(changes({ reason: 'Fraud' }, {}), [
    { field: 'reason', from: 'Fraud', to: null },
  ]);
});

test('an unknown action is still readable', () => {
  // The log must never hide an entry because the label list is out of date.
  assert.equal(label('something.new_happened'), 'Something new happened');
  assert.equal(label('account.suspended'), 'Account suspended');
});

// ------------------------------------------------------------------ the API

test('Audit log', async (t) => {
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  t.after(async () => {
    server.close();
    await pool.end();
  });

  const admin = { token: (await signIn(port, 'admin@servicesetu.in')).body.data.accessToken };
  const customer = { token: (await signIn(port, 'customer@servicesetu.in')).body.data.accessToken };

  await t.test('an admin action appears in the trail', async () => {
    /**
     * The whole point, tested end to end rather than by reading the table:
     * do something consequential, then find it on the screen that is supposed
     * to show it.
     */
    const before = (await request(port, 'GET', '/api/v1/admin/audit?limit=1', admin)).body;

    await request(port, 'GET', '/api/v1/admin/backup/export/people', admin);

    const after = (await request(port, 'GET', '/api/v1/admin/audit?limit=5', admin)).body;
    assert.ok(after.meta.total > before.meta.total, 'the trail grew');

    const entry = after.data[0];
    assert.equal(entry.action, 'data.exported');
    assert.equal(entry.label, 'Data exported', 'in words, not in dotted keys');
    assert.equal(entry.admin.email, 'admin@servicesetu.in', 'named against who did it');
    assert.ok(entry.at, 'and when');
  });

  await t.test('entries read newest first', async () => {
    const res = await request(port, 'GET', '/api/v1/admin/audit?limit=10', admin);
    const times = res.body.data.map((r) => new Date(r.at).getTime());

    for (let i = 1; i < times.length; i += 1) {
      assert.ok(times[i - 1] >= times[i], 'a trail out of order is hard to read and easy to doubt');
    }
  });

  await t.test('it can be filtered by what happened', async () => {
    const res = await request(port, 'GET', '/api/v1/admin/audit?action=data.exported', admin);

    assert.equal(res.status, 200);
    assert.ok(res.body.data.length > 0);
    assert.ok(
      res.body.data.every((r) => r.action === 'data.exported'),
      'a filter that lets other actions through is worse than none',
    );
  });

  await t.test('a date range excludes what falls outside it', async () => {
    const old = await request(port, 'GET', '/api/v1/admin/audit?to=2020-01-01', admin);
    assert.equal(old.body.meta.total, 0, 'nothing happened before this platform existed');

    const today = new Date().toISOString().slice(0, 10);
    const now = await request(port, 'GET', '/api/v1/admin/audit?from=' + today, admin);
    assert.ok(now.body.meta.total > 0, "and today's entries are inside a range ending today");
  });

  await t.test('a malformed date is refused rather than ignored', async () => {
    // Silently dropping it would show everything while appearing to filter.
    const res = await request(port, 'GET', '/api/v1/admin/audit?from=last-tuesday', admin);
    assert.equal(res.status, 422);
  });

  await t.test('the filters offer only what the log actually holds', async () => {
    const res = await request(port, 'GET', '/api/v1/admin/audit/filters', admin);
    assert.equal(res.status, 200);

    const { actions, admins, coverage } = res.body.data;
    assert.ok(actions.length > 0);
    assert.ok(actions.every((a) => a.n > 0), 'no option that would return nothing');
    assert.ok(admins.some((a) => a.email === 'admin@servicesetu.in'));
    assert.ok(coverage.total > 0 && coverage.oldest, 'the screen can say how far back it goes');
  });

  await t.test('a settings change shows what moved, not both states in full', async () => {
    // A value different from whatever is there now. Saving the same number
    // twice records an entry with nothing in it, which is correct - somebody
    // did press save - but proves nothing about computing a difference.
    const settings = (await request(port, 'GET', '/api/v1/admin/settings', admin)).body.data;
    const current = settings.commission.defaultPercent;

    try {
      await request(port, 'PUT', '/api/v1/admin/settings/commission', {
        ...admin, body: { defaultPercent: current === 17 ? 18 : 17 },
      });

      const res = await request(port, 'GET', '/api/v1/admin/audit?action=settings.updated&limit=1', admin);
      const entry = res.body.data[0];

      assert.ok(entry.changes.length > 0, 'the difference is computed for the reader');
      assert.ok(
        entry.changes.every((c) => JSON.stringify(c.from) !== JSON.stringify(c.to)),
        'and holds only fields that actually differ',
      );
    } finally {
      // Put it back. Commission is read by every money calculation on the
      // platform, so leaving it moved breaks the payout suite that runs
      // later - which is how this was found.
      await request(port, 'PUT', '/api/v1/admin/settings/commission', {
        ...admin, body: { defaultPercent: current },
      });
    }
  });

  await t.test('it exports as CSV', async () => {
    const res = await request(port, 'GET', '/api/v1/admin/audit?format=csv', admin);

    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/csv/);
    assert.match(res.headers['content-disposition'], /servicemitra-audit-log-\d{4}-\d{2}-\d{2}\.csv/);
    assert.match(res.raw, /When,Action,Admin/, 'with a header row naming the columns');
    assert.ok(res.raw.split('\r\n').length > 2, 'and rows under it');
  });

  await t.test('there is no way to change or delete an entry', async () => {
    /**
     * An audit log that can be edited through the API it audits is not one.
     * These must not exist, so a 404 or 405 is the pass - anything that
     * succeeds is a hole.
     */
    const first = (await request(port, 'GET', '/api/v1/admin/audit?limit=1', admin)).body.data[0];

    for (const method of ['DELETE', 'PATCH', 'PUT', 'POST']) {
      const res = await request(port, method, '/api/v1/admin/audit/' + first.id, {
        ...admin, body: { reason: 'tampered' },
      });
      assert.ok(res.status === 404 || res.status === 405, method + ' must not be routed');
    }

    const still = await queryOne('SELECT reason FROM admin_audit_log WHERE id = $1', [first.id]);
    assert.notEqual(still.reason, 'tampered');
  });

  await t.test('no one but an admin can read it', async () => {
    // It names who did what and from which address. That is not a list for
    // customers or providers.
    assert.equal((await request(port, 'GET', '/api/v1/admin/audit', customer)).status, 403);
    assert.equal((await request(port, 'GET', '/api/v1/admin/audit/filters', customer)).status, 403);
    assert.equal((await request(port, 'GET', '/api/v1/admin/audit')).status, 401);
  });

  await t.test('an entry survives the admin account that made it', async () => {
    /**
     * `admin_id` is ON DELETE SET NULL, so removing an admin leaves their
     * entries behind without a name. The record of what happened must not
     * disappear with the person who did it.
     */
    const row = await queryOne(
      `INSERT INTO admin_audit_log (admin_id, action, entity_type, reason)
       VALUES (NULL, 'account.suspended', 'user', 'Recorded by an account since removed')
       RETURNING id`,
    );

    try {
      const res = await request(port, 'GET', '/api/v1/admin/audit?search=' + encodeURIComponent('since removed'), admin);
      const entry = res.body.data.find((r) => r.id === String(row.id));

      assert.ok(entry, 'still listed');
      assert.equal(entry.admin, null, 'with no admin rather than a crash');
      assert.equal(entry.label, 'Account suspended');
    } finally {
      await query('DELETE FROM admin_audit_log WHERE id = $1', [row.id]);
    }
  });
  /**
   * None of these are truncated - they are complete addresses that simply do
   * not all look like 203.0.113.44. The export is read in a spreadsheet by a
   * person, so "::1" on its own reads as a value that got cut off.
   */
  await t.test('an address is shown in a form a reader can act on', async () => {
    const { readableIp } = await import('../src/modules/admin/audit.service.js');

    assert.equal(
      readableIp('::ffff:203.0.113.44'), '203.0.113.44',
      'an IPv4 client over an IPv6 socket is unwrapped, not left wearing ::ffff:',
    );
    assert.equal(readableIp('203.0.113.44'), '203.0.113.44', 'a plain address is untouched');
    assert.equal(
      readableIp('2401:4900:1c80:abcd::42'), '2401:4900:1c80:abcd::42',
      'a real IPv6 address is left exactly as recorded',
    );

    for (const loopback of ['::1', '127.0.0.1']) {
      const shown = readableIp(loopback);
      assert.ok(shown.startsWith(loopback), 'the address itself is still there in full');
      assert.match(shown, /server itself/, 'and says what it means');
    }

    assert.equal(readableIp(null), '', 'a missing address is empty, not the word null');
  });
});
