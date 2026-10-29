/**
 * Phase 7 tests: booking creation, slot validation, accept/reject, cancellation
 * policy and rescheduling.
 *
 * The headline claims: the price comes from the server and not the client, a
 * slot outside working hours is refused, two customers cannot take the same
 * slot, and contact details are released only on acceptance.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { pool, query, queryOne } from '../src/db/pool.js';
import { registerAndConfirm } from './helpers/signup.js';

const PASSWORD = 'Password@123';
const SECOND_CUSTOMER_PHONE = '9555533001';

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
  (await request(port, 'POST', '/api/v1/auth/login', { body: { identifier, password: PASSWORD } })).body.data;

const ADDRESS = {
  line: '12 MG Road, Near City Park',
  city: 'Bidar',
  state: 'Karnataka',
  pincode: '585401',
  lat: 17.9104,
  lng: 77.5199,
};

/** A future weekday at a given local hour. Providers are closed on Sunday. */
function weekdayAt(hour, daysAhead = 2) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}

async function cleanup() {
  await query("DELETE FROM bookings WHERE description = 'phase7-test'");
  await query('DELETE FROM users WHERE phone = $1', [SECOND_CUSTOMER_PHONE]);
}

test('Phase 7: booking and scheduling', async (t) => {
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
  const providerLogin = await signIn(port, 'plumber@servicesetu.in');
  const cAuth = { token: customer.accessToken };
  const pAuth = { token: providerLogin.accessToken };

  const provider = await queryOne(
    "SELECT p.id FROM provider_profiles p JOIN users u ON u.id = p.user_id WHERE u.email = 'plumber@servicesetu.in'",
  );
  const category = (await request(port, 'GET', '/api/v1/categories/drain-cleaning')).body.data;

  const newBooking = (start, overrides = {}) => ({
    providerId: provider.id,
    categoryId: category.id,
    scheduledStart: start.toISOString(),
    address: ADDRESS,
    description: 'phase7-test',
    ...overrides,
  });

  let bookingId = null;

  await t.test('a customer can request a booking in a working window', async () => {
    const res = await request(port, 'POST', '/api/v1/bookings', {
      ...cAuth, body: newBooking(weekdayAt(10)),
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.status, 'requested');
    assert.ok(res.body.data.reference.startsWith('BK-'));
    bookingId = res.body.data.id;
  });

  await t.test('the provider is emailed the request, not only told in-app', async () => {
    // Notification fan-out is fire-and-forget so the booking is not held up by
    // a slow mail server; give it a moment to land.
    const providerUserId = await queryOne(
      'SELECT user_id FROM provider_profiles WHERE id = $1',
      [provider.id],
    );

    // Waits for both rows to reach 'sent', not merely to exist. A row is
    // written as 'pending' and updated when the send returns, so a loop that
    // stops at `rows.length === 2` reads the status in between on a slow run.
    const settled = (r) => r.length >= 2 && r.every((row) => row.status !== 'pending');

    let rows = [];
    for (let attempt = 0; attempt < 40 && !settled(rows); attempt += 1) {
      await new Promise((r) => setTimeout(r, 100));
      rows = await (await import('../src/db/pool.js')).queryMany(
        `SELECT channel, status FROM notifications
          WHERE user_id = $1 AND event_type = 'booking.requested' AND entity_id = $2`,
        [providerUserId.user_id, bookingId],
      );
    }

    const channels = Object.fromEntries(rows.map((r) => [r.channel, r.status]));
    assert.equal(channels.in_app, 'sent', 'still recorded in the app');
    assert.equal(
      channels.email,
      'sent',
      'and emailed, because a request that expires in an hour is no use to a logged-out provider',
    );
  });

  await t.test('the price is taken from the provider rate, not the request', async () => {
    const res = await request(port, 'GET', '/api/v1/bookings/' + bookingId, cAuth);
    const offering = await queryOne(
      'SELECT price_minor FROM provider_categories WHERE provider_id = $1 AND category_id = $2',
      [provider.id, category.id],
    );
    assert.equal(res.body.data.pricing.quotedMinor, offering.price_minor);
    assert.ok(res.body.data.pricing.commissionPercent > 0, 'commission frozen on the booking');
  });

  await t.test('a client-supplied amount is ignored', async () => {
    const res = await request(port, 'POST', '/api/v1/bookings', {
      ...cAuth,
      // 15:00, well clear of the 10:00 booking's 75-minute window.
      body: newBooking(weekdayAt(15), { quotedAmountMinor: 1, priceMinor: 1, amount: 1 }),
    });
    assert.equal(res.status, 201);
    assert.notEqual(res.body.data.pricing.quotedMinor, 1, 'injected price had no effect');
    await query('DELETE FROM bookings WHERE id = $1', [res.body.data.id]);
  });

  await t.test('a slot outside working hours is refused', async () => {
    const res = await request(port, 'POST', '/api/v1/bookings', {
      ...cAuth, body: newBooking(weekdayAt(22)),
    });
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /does not work at that time/i);
  });

  await t.test('a time in the past is refused', async () => {
    const res = await request(port, 'POST', '/api/v1/bookings', {
      ...cAuth, body: newBooking(new Date(Date.now() - 86400000)),
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /future/i);
  });

  await t.test('a date too far ahead is refused', async () => {
    const res = await request(port, 'POST', '/api/v1/bookings', {
      ...cAuth, body: newBooking(weekdayAt(10, 120)),
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /days ahead/i);
  });

  await t.test('an address the provider does not cover is refused', async () => {
    const res = await request(port, 'POST', '/api/v1/bookings', {
      ...cAuth,
      body: newBooking(weekdayAt(12), {
        address: { ...ADDRESS, city: 'Mumbai', pincode: '400001' },
      }),
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /does not serve/i);
  });

  await t.test('a second customer cannot take the same slot', async () => {
    await registerAndConfirm(request, port, {
      role: 'customer',
      fullName: 'Second Customer',
      email: 'second.customer@test.local',
      phone: SECOND_CUSTOMER_PHONE,
      password: PASSWORD,
    });
    const second = await signIn(port, SECOND_CUSTOMER_PHONE);

    const existing = await request(port, 'GET', '/api/v1/bookings/' + bookingId, cAuth);
    const takenSlot = new Date(existing.body.data.schedule.start);

    const res = await request(port, 'POST', '/api/v1/bookings', {
      token: second.accessToken, body: newBooking(takenSlot),
    });
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /taken/i);
  });

  await t.test('contact details are withheld while the request is pending', async () => {
    const res = await request(port, 'GET', '/api/v1/bookings/' + bookingId, cAuth);
    assert.equal(res.body.data.provider.phone, null);
  });

  await t.test('a customer cannot read a booking that is not theirs', async () => {
    const second = await signIn(port, SECOND_CUSTOMER_PHONE);
    const res = await request(port, 'GET', '/api/v1/bookings/' + bookingId, { token: second.accessToken });
    assert.equal(res.status, 403);
  });

  await t.test('a customer cannot accept their own booking', async () => {
    const res = await request(port, 'POST', '/api/v1/bookings/' + bookingId + '/accept', cAuth);
    assert.equal(res.status, 403);
  });

  await t.test('the assigned provider can accept, which releases contact details', async () => {
    const res = await request(port, 'POST', '/api/v1/bookings/' + bookingId + '/accept', pAuth);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'accepted');

    const asCustomer = await request(port, 'GET', '/api/v1/bookings/' + bookingId, cAuth);
    assert.ok(asCustomer.body.data.provider.phone, 'provider phone released on acceptance');

    const asProvider = await request(port, 'GET', '/api/v1/bookings/' + bookingId, pAuth);
    assert.ok(asProvider.body.data.customer.phone, 'customer phone released on acceptance');
  });

  await t.test('accepting twice is rejected by the state machine', async () => {
    const res = await request(port, 'POST', '/api/v1/bookings/' + bookingId + '/accept', pAuth);
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /already accepted/i);
  });
});
