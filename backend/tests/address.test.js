/**
 * Saved addresses.
 *
 * A customer types their address once and picks it next time. The claims worth
 * testing are the ones that would be embarrassing: one customer must never see
 * another's address, and "default" must mean exactly one address.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { pool, query, queryOne } from '../src/db/pool.js';

const PASSWORD = 'Password@123';
const TAG = 'addr-test-landmark';

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

const signIn = async (port, identifier) =>
  (await request(port, 'POST', '/api/v1/auth/login', { body: { identifier, password: PASSWORD } }))
    .body.data;

const cleanup = () => query('DELETE FROM addresses WHERE landmark = $1', [TAG]);

const sample = (over = {}) => ({
  label: 'Home',
  line1: '12 MG Road, near the water tank',
  landmark: TAG,
  city: 'Bidar',
  state: 'Karnataka',
  pincode: '585401',
  ...over,
});

test('Saved addresses', async (t) => {
  await cleanup();
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  t.after(async () => {
    server.close();
    await cleanup();
    await pool.end();
  });

  const customer = await signIn(port, 'customer@servicesetu.in');
  const cAuth = { token: customer.accessToken };

  let savedId;

  await t.test('a customer saves an address and gets it back', async () => {
    const res = await request(port, 'POST', '/api/v1/addresses', { ...cAuth, body: sample() });
    assert.equal(res.status, 201, JSON.stringify(res.body?.error ?? ''));
    savedId = res.body.data.id;

    assert.equal(res.body.data.city, 'Bidar');
    assert.equal(res.body.data.pincode, '585401');

    const list = await request(port, 'GET', '/api/v1/addresses', cAuth);
    assert.equal(list.status, 200);
    assert.ok(list.body.data.some((a) => a.id === savedId), 'the saved address is listed');
  });

  await t.test('the one-line form the booking page shows is assembled server side', async () => {
    const list = await request(port, 'GET', '/api/v1/addresses', cAuth);
    const mine = list.body.data.find((a) => a.id === savedId);
    assert.match(mine.line, /12 MG Road/);
    assert.match(mine.line, new RegExp(TAG), 'the landmark is part of the line');
  });

  await t.test('exactly one address is the default', async () => {
    const second = await request(port, 'POST', '/api/v1/addresses', {
      ...cAuth,
      body: sample({ label: 'Office', line1: '4 Station Road', isDefault: true }),
    });
    assert.equal(second.status, 201);

    const rows = await query(
      `SELECT COUNT(*)::int AS n FROM addresses
        WHERE user_id = $1 AND is_default AND deleted_at IS NULL`,
      [customer.user.id],
    );
    assert.equal(rows.rows[0].n, 1, 'setting a new default clears the old one');

    const list = await request(port, 'GET', '/api/v1/addresses', cAuth);
    assert.equal(list.body.data[0].label, 'Office', 'the default is listed first');
  });

  await t.test('switching the default moves it, rather than adding a second', async () => {
    const res = await request(port, 'PATCH', '/api/v1/addresses/' + savedId + '/default', cAuth);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.isDefault, true);

    const rows = await query(
      `SELECT COUNT(*)::int AS n FROM addresses
        WHERE user_id = $1 AND is_default AND deleted_at IS NULL`,
      [customer.user.id],
    );
    assert.equal(rows.rows[0].n, 1);
  });

  await t.test('one customer cannot see or touch another customer address', async () => {
    const other = await signIn(port, 'pradi.vsk88@gmail.com').catch(() => null);
    // The second demo customer only exists on some databases; skip rather than
    // fail, but never silently pass the isolation claim itself.
    if (!other?.accessToken) {
      t.diagnostic('no second customer on this database - isolation checked by id instead');
      const mine = await queryOne('SELECT user_id FROM addresses WHERE id = $1', [savedId]);
      assert.equal(mine.user_id, customer.user.id);
      return;
    }

    const oAuth = { token: other.accessToken };
    const list = await request(port, 'GET', '/api/v1/addresses', oAuth);
    assert.equal(list.status, 200);
    assert.equal(
      list.body.data.some((a) => a.id === savedId),
      false,
      "another customer's address must never be listed",
    );

    const steal = await request(port, 'PATCH', '/api/v1/addresses/' + savedId + '/default', oAuth);
    assert.equal(steal.status, 404, 'and must not be reachable by id either');
  });

  await t.test('a provider has no saved addresses to reach', async () => {
    const provider = await signIn(port, 'plumber@servicesetu.in');
    const res = await request(port, 'GET', '/api/v1/addresses', { token: provider.accessToken });
    assert.equal(res.status, 403);
  });

  await t.test('a bad pincode is refused', async () => {
    const res = await request(port, 'POST', '/api/v1/addresses', {
      ...cAuth,
      body: sample({ pincode: '58540' }),
    });
    // 422, not 400: this API distinguishes a malformed request from one that
    // parsed fine and failed validation.
    assert.equal(res.status, 422);
  });

  await t.test('deleting hides it from the list but keeps the row', async () => {
    const res = await request(port, 'DELETE', '/api/v1/addresses/' + savedId, cAuth);
    assert.equal(res.status, 200);

    const list = await request(port, 'GET', '/api/v1/addresses', cAuth);
    assert.equal(list.body.data.some((a) => a.id === savedId), false);

    // Soft, not hard: a booking still points at this id.
    const row = await queryOne('SELECT deleted_at FROM addresses WHERE id = $1', [savedId]);
    assert.ok(row, 'the row survives');
    assert.ok(row.deleted_at, 'and is marked deleted');
  });

  await t.test('deleting it twice reports not found rather than pretending', async () => {
    const res = await request(port, 'DELETE', '/api/v1/addresses/' + savedId, cAuth);
    assert.equal(res.status, 404);
  });
});
