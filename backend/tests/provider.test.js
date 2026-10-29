/**
 * Phase 4 tests: provider self-service - profile, services, areas, schedule
 * and the go-live gate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db/pool.js';
import { registerAndConfirm } from './helpers/signup.js';

const PASSWORD = 'Password@123';
const NEW_PROVIDER_PHONE = '9555511001';

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

const signIn = async (port, identifier) =>
  (await request(port, 'POST', '/api/v1/auth/login', { body: { identifier, password: PASSWORD } }))
    .body.data;

const cleanup = () => query('DELETE FROM users WHERE phone = $1', [NEW_PROVIDER_PHONE]);

test('Phase 4: provider self-service', async (t) => {
  await cleanup();
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  t.after(async () => {
    server.close();
    await cleanup();
    await pool.end();
  });

  const provider = await signIn(port, 'plumber@servicesetu.in');
  const customer = await signIn(port, 'customer@servicesetu.in');
  const auth = { token: provider.accessToken };

  await t.test('a customer cannot reach provider endpoints', async () => {
    const res = await request(port, 'GET', '/api/v1/providers/me', { token: customer.accessToken });
    assert.equal(res.status, 403);
  });

  await t.test('a seeded provider is set up and discoverable', async () => {
    const res = await request(port, 'GET', '/api/v1/providers/me', auth);
    assert.equal(res.status, 200);
    const p = res.body.data;
    assert.equal(p.verificationStatus, 'approved');
    assert.equal(p.isDiscoverable, true);
    assert.ok(p.services.length >= 3, 'services present');
    assert.ok(p.serviceAreas.length >= 1, 'service area present');
    assert.equal(p.readiness.complete, true);
    assert.equal(p.readiness.percentComplete, 100);
  });

  await t.test('profile fields can be updated', async () => {
    const res = await request(port, 'PATCH', '/api/v1/providers/me', {
      ...auth,
      body: { headline: 'Emergency plumbing, 24x7 in Bidar', experienceYears: 13 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.experienceYears, 13);
  });

  await t.test('a price below the admin minimum is rejected', async () => {
    const category = (await request(port, 'GET', '/api/v1/categories/tap-mixer-repair')).body.data;
    const res = await request(port, 'PUT', '/api/v1/providers/me/services', {
      ...auth,
      body: { categoryId: category.id, priceMinor: 1000 },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /below the minimum/i);
  });

  await t.test('a price above the admin maximum is rejected', async () => {
    const category = (await request(port, 'GET', '/api/v1/categories/tap-mixer-repair')).body.data;
    const res = await request(port, 'PUT', '/api/v1/providers/me/services', {
      ...auth,
      body: { categoryId: category.id, priceMinor: 999900 },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /above the maximum/i);
  });

  await t.test('a price inside the band is accepted', async () => {
    const category = (await request(port, 'GET', '/api/v1/categories/tap-mixer-repair')).body.data;
    const res = await request(port, 'PUT', '/api/v1/providers/me/services', {
      ...auth,
      body: { categoryId: category.id, priceMinor: 32900, visitChargeMinor: 5000 },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.priceMinor, 32900);
    assert.equal(res.body.data.price, 329, 'rupee value computed for the UI');
  });

  await t.test('overlapping working hours are rejected', async () => {
    const first = await request(port, 'POST', '/api/v1/providers/me/schedule/windows', {
      ...auth,
      body: { dayOfWeek: 0, startTime: '10:00', endTime: '14:00' },
    });
    assert.equal(first.status, 201);

    const clash = await request(port, 'POST', '/api/v1/providers/me/schedule/windows', {
      ...auth,
      body: { dayOfWeek: 0, startTime: '13:00', endTime: '16:00' },
    });
    assert.equal(clash.status, 409);
    assert.match(clash.body.error.message, /overlaps/i);

    await request(port, 'DELETE', '/api/v1/providers/me/schedule/windows/' + first.body.data.id, auth);
  });

  await t.test('a window ending before it starts is rejected', async () => {
    const res = await request(port, 'POST', '/api/v1/providers/me/schedule/windows', {
      ...auth,
      body: { dayOfWeek: 3, startTime: '16:00', endTime: '09:00' },
    });
    assert.equal(res.status, 422);
  });

  await t.test('the weekly schedule reads back grouped by day', async () => {
    const res = await request(port, 'GET', '/api/v1/providers/me/schedule', auth);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.week.length, 7);
    const monday = res.body.data.week.find((d) => d.day === 'Monday');
    assert.ok(monday.windows.length >= 1);
    assert.equal(monday.windows[0].startTime, '09:00');
  });

  await t.test('a provider can go offline and back online', async () => {
    const off = await request(port, 'PATCH', '/api/v1/providers/me/status', {
      ...auth, body: { isAcceptingBookings: false },
    });
    assert.equal(off.body.data.isDiscoverable, false);

    const on = await request(port, 'PATCH', '/api/v1/providers/me/status', {
      ...auth, body: { isAcceptingBookings: true },
    });
    assert.equal(on.body.data.isDiscoverable, true);
  });

  await t.test('an unverified provider cannot go live but can still build a profile', async () => {
    const registered = await registerAndConfirm(request, port, {
      role: 'provider',
      fullName: 'Brand New',
      email: 'brand.new@test.local',
      phone: NEW_PROVIDER_PHONE,
      password: PASSWORD,
    });
    assert.equal(registered.status, 201);
    const fresh = { token: registered.body.data.accessToken };

    const profile = await request(port, 'GET', '/api/v1/providers/me', fresh);
    assert.equal(profile.body.data.readiness.complete, false);
    assert.equal(profile.body.data.isDiscoverable, false);

    const edit = await request(port, 'PATCH', '/api/v1/providers/me', {
      ...fresh, body: { headline: 'Ready and waiting' },
    });
    assert.equal(edit.status, 200, 'profile editing is not gated on verification');

    const goLive = await request(port, 'PATCH', '/api/v1/providers/me/status', {
      ...fresh, body: { isAcceptingBookings: true },
    });
    assert.equal(goLive.status, 403);
    assert.equal(goLive.body.error.code, 'PROVIDER_NOT_VERIFIED');
  });
});
