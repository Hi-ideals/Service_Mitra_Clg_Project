/**
 * Phase 7 tests, part two: cancellation policy, rescheduling, scoped listings
 * and the state machine's refusal to allow impossible transitions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { pool, query, queryOne } from '../src/db/pool.js';
import { expireStaleRequests } from '../src/modules/bookings/booking.service.js';

const PASSWORD = 'Password@123';
const TAG = 'phase7-lifecycle';

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
  line: '12 MG Road', city: 'Bidar', state: 'Karnataka', pincode: '585401',
  lat: 17.9104, lng: 77.5199,
};

function weekdayAt(hour, daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}

const cleanup = () => query('DELETE FROM bookings WHERE description = $1', [TAG]);

test('Phase 7: lifecycle, policy and scope', async (t) => {
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
  const admin = await signIn(port, 'admin@servicesetu.in');
  const cAuth = { token: customer.accessToken };
  const pAuth = { token: providerLogin.accessToken };
  const aAuth = { token: admin.accessToken };

  const provider = await queryOne(
    "SELECT p.id FROM provider_profiles p JOIN users u ON u.id = p.user_id WHERE u.email = 'plumber@servicesetu.in'",
  );
  const category = (await request(port, 'GET', '/api/v1/categories/tap-mixer-repair')).body.data;

  const book = async (start) => {
    const res = await request(port, 'POST', '/api/v1/bookings', {
      ...cAuth,
      body: {
        providerId: provider.id,
        categoryId: category.id,
        scheduledStart: start.toISOString(),
        address: ADDRESS,
        description: TAG,
      },
    });
    assert.equal(res.status, 201, 'setup booking created: ' + JSON.stringify(res.body?.error ?? ''));
    return res.body.data;
  };

  await t.test('cancelling a pending request is always free', async () => {
    const booking = await book(weekdayAt(9, 4));

    const quote = await request(port, 'GET', '/api/v1/bookings/' + booking.id + '/cancellation-quote', cAuth);
    assert.equal(quote.status, 200);
    assert.equal(quote.body.data.feeMinor, 0);
    assert.match(quote.body.data.reason, /not accepted yet/i);

    const res = await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/cancel', {
      ...cAuth, body: { reason: 'Found another time that suits better' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.booking.status, 'cancelled');
    assert.equal(res.body.data.cancellation.feeMinor, 0);
  });

  /**
   * Both sides, every time. The customer who pressed the button wants the
   * record that they are not being charged; the professional needs to know
   * not to set out. Before this, only whoever did *not* cancel was told.
   */
  await t.test('cancelling emails the customer and the professional', async () => {
    const booking = await book(weekdayAt(10, 5));
    await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/accept', pAuth);

    const res = await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/cancel', {
      ...cAuth, body: { reason: 'Plans changed, sorry' },
    });
    assert.equal(res.status, 200);

    // Delivery is fire-and-forget, so the rows appear just after the response.
    const settled = (r) => r.length >= 4 && r.every((row) => row.status !== 'pending');
    let rows = [];
    for (let attempt = 0; attempt < 40 && !settled(rows); attempt += 1) {
      await new Promise((r) => setTimeout(r, 100));
      rows = await query(
        `SELECT user_id, channel, status FROM notifications
          WHERE event_type = 'booking.cancelled' AND entity_id = $1`,
        [booking.id],
      ).then((r) => r.rows);
    }

    const providerUser = await queryOne(
      'SELECT user_id FROM provider_profiles WHERE id = $1', [provider.id],
    );

    const emailed = new Set(
      rows.filter((r) => r.channel === 'email' && r.status === 'sent').map((r) => r.user_id),
    );

    assert.ok(emailed.has(customer.user.id), 'the customer who cancelled was emailed too');
    assert.ok(emailed.has(providerUser.user_id), 'the professional was emailed');
  });

  await t.test('an admin cancelling still reaches the professional', async () => {
    const booking = await book(weekdayAt(11, 6));
    await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/accept', pAuth);

    const res = await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/cancel', {
      ...aAuth, body: { reason: 'Cancelled by support' },
    });
    assert.equal(res.status, 200);

    const providerUser = await queryOne(
      'SELECT user_id FROM provider_profiles WHERE id = $1', [provider.id],
    );

    let rows = [];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((r) => setTimeout(r, 100));
      rows = await query(
        `SELECT user_id, channel FROM notifications
          WHERE event_type = 'booking.cancelled' AND entity_id = $1`,
        [booking.id],
      ).then((r) => r.rows);
      const who = new Set(rows.map((r) => r.user_id));
      if (who.has(customer.user.id) && who.has(providerUser.user_id)) break;
    }

    const who = new Set(rows.map((r) => r.user_id));
    assert.ok(who.has(providerUser.user_id), 'a provider is not left expecting a cancelled job');
    assert.ok(who.has(customer.user.id), 'and the customer is told as well');
  });

  await t.test('a cancelled slot becomes bookable again', async () => {
    const slot = weekdayAt(10, 5);
    const first = await book(slot);
    await request(port, 'POST', '/api/v1/bookings/' + first.id + '/cancel', {
      ...cAuth, body: { reason: 'Changed my mind about the timing' },
    });

    const second = await book(slot);
    assert.equal(second.status, 'requested', 'the freed slot was taken again');
  });

  await t.test('cancelling an accepted booking well ahead of time is free', async () => {
    const booking = await book(weekdayAt(11, 6));
    await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/accept', pAuth);

    const quote = await request(port, 'GET', '/api/v1/bookings/' + booking.id + '/cancellation-quote', cAuth);
    assert.equal(quote.body.data.feeMinor, 0);
    assert.match(quote.body.data.reason, /free cancellation/i);
  });

  await t.test('a late cancellation carries the configured fee', async () => {
    const booking = await book(weekdayAt(14, 2));
    await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/accept', pAuth);

    // Pull the appointment inside the free window without touching the policy.
    await query(
      "UPDATE bookings SET scheduled_start = NOW() + INTERVAL '2 hours', scheduled_end = NOW() + INTERVAL '3 hours' WHERE id = $1",
      [booking.id],
    );

    const quote = await request(port, 'GET', '/api/v1/bookings/' + booking.id + '/cancellation-quote', cAuth);
    assert.ok(quote.body.data.feeMinor > 0, 'a fee applies inside the free window');
    assert.match(quote.body.data.reason, /late cancellation/i);

    const expectedFee = Math.round((booking.pricing.quotedMinor * 20) / 100);
    assert.equal(quote.body.data.feeMinor, expectedFee, 'fee is 20% of the quote');
    assert.equal(
      quote.body.data.refundMinor,
      booking.pricing.quotedMinor - expectedFee,
      'refund is the remainder',
    );

    // Release the slot so the next fixture is not blocked by it.
    await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/cancel', {
      ...cAuth, body: { reason: 'Accepting the late cancellation fee' },
    });
  });

  await t.test('a provider cancelling never charges the customer', async () => {
    const booking = await book(weekdayAt(15, 2));
    await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/accept', pAuth);
    await query(
      "UPDATE bookings SET scheduled_start = NOW() + INTERVAL '8 hours', scheduled_end = NOW() + INTERVAL '9 hours' WHERE id = $1",
      [booking.id],
    );

    const res = await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/cancel', {
      ...pAuth, body: { reason: 'Van broke down, cannot reach you today' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.cancellation.feeMinor, 0);
    assert.equal(res.body.data.booking.cancellation.by, 'provider');
  });

  // ---------- rescheduling ----------

  await t.test('rescheduling re-validates the new slot', async () => {
    const booking = await book(weekdayAt(9, 8));

    const bad = await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/reschedule', {
      ...cAuth, body: { scheduledStart: weekdayAt(23, 8).toISOString() },
    });
    assert.equal(bad.status, 409, 'a slot outside working hours is still refused');

    const good = await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/reschedule', {
      ...cAuth, body: { scheduledStart: weekdayAt(16, 8).toISOString(), reason: 'Work meeting moved' },
    });
    assert.equal(good.status, 200);
    assert.equal(new Date(good.body.data.booking.schedule.start).getHours(), 16);
  });

  await t.test('a customer moving an accepted booking sends it back for confirmation', async () => {
    const booking = await book(weekdayAt(10, 9));
    await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/accept', pAuth);

    const res = await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/reschedule', {
      ...cAuth, body: { scheduledStart: weekdayAt(14, 9).toISOString(), reason: 'Something came up' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.requiresReconfirmation, true);
    assert.equal(res.body.data.booking.status, 'requested', 'the provider agreed to a time, not an open commitment');
  });

  // ---------- state machine ----------

  await t.test('impossible transitions are refused with a usable explanation', async () => {
    const booking = await book(weekdayAt(11, 10));

    // requested -> in_progress is not a legal edge.
    const early = await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/accept', cAuth);
    assert.equal(early.status, 403, 'a customer cannot accept');

    await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/cancel', {
      ...cAuth, body: { reason: 'No longer needed at all' },
    });

    const afterCancel = await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/accept', pAuth);
    assert.equal(afterCancel.status, 409);
    assert.match(afterCancel.body.error.message, /cancelled/i);

    const reschedule = await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/reschedule', {
      ...cAuth, body: { scheduledStart: weekdayAt(12, 11).toISOString() },
    });
    assert.equal(reschedule.status, 409, 'a cancelled booking cannot be moved');
  });

  await t.test('available actions reflect who is asking', async () => {
    const booking = await book(weekdayAt(12, 12));

    const asProvider = await request(port, 'GET', '/api/v1/bookings/' + booking.id, pAuth);
    const providerActions = asProvider.body.data.availableActions.map((a) => a.to);
    assert.ok(providerActions.includes('accepted'));
    assert.ok(providerActions.includes('rejected'));

    const asCustomer = await request(port, 'GET', '/api/v1/bookings/' + booking.id, cAuth);
    const customerActions = asCustomer.body.data.availableActions.map((a) => a.to);
    assert.ok(customerActions.includes('cancelled'));
    assert.ok(!customerActions.includes('accepted'), 'a customer is never offered accept');
  });

  await t.test('rejection records the reason and is visible to the customer', async () => {
    const booking = await book(weekdayAt(13, 13));

    const res = await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/reject', {
      ...pAuth, body: { reason: 'Already committed to another job in that area' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'rejected');

    const seen = await request(port, 'GET', '/api/v1/bookings/' + booking.id, cAuth);
    assert.match(seen.body.data.rejectionReason, /already committed/i);
  });

  // ---------- history, scope and expiry ----------

  await t.test('every transition is recorded in the history', async () => {
    const booking = await book(weekdayAt(14, 14));
    await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/accept', pAuth);
    await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/cancel', {
      ...pAuth, body: { reason: 'Emergency elsewhere, very sorry' },
    });

    const res = await request(port, 'GET', '/api/v1/bookings/' + booking.id, cAuth);
    const steps = res.body.data.history.map((h) => h.to);
    assert.deepEqual(steps, ['requested', 'accepted', 'cancelled']);
    assert.equal(res.body.data.history[1].actorType, 'provider');
    assert.match(res.body.data.history[2].reason, /emergency/i);
  });

  await t.test('listings are scoped by identity, not by query string', async () => {
    const asCustomer = await request(port, 'GET', '/api/v1/bookings?limit=50', cAuth);
    assert.ok(asCustomer.body.data.every((b) => b.customer.id === customer.user.id));

    // Passing another party's id changes nothing - scope comes from the token.
    const injected = await request(
      port, 'GET', '/api/v1/bookings?limit=50&customerId=' + provider.id, cAuth,
    );
    assert.deepEqual(
      injected.body.data.map((b) => b.id).sort(),
      asCustomer.body.data.map((b) => b.id).sort(),
      'the injected parameter was ignored',
    );

    const asAdmin = await request(port, 'GET', '/api/v1/bookings?limit=50', aAuth);
    assert.ok(asAdmin.body.meta.total >= asCustomer.body.meta.total, 'an admin sees everything');
  });

  await t.test('status counts drive the dashboard tabs', async () => {
    const res = await request(port, 'GET', '/api/v1/bookings/counts', pAuth);
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.data.requested, 'number');
    assert.equal(typeof res.body.data.completed, 'number');
  });

  await t.test('an unanswered request is auto-cancelled once its deadline passes', async () => {
    const booking = await book(weekdayAt(15, 15));

    await query("UPDATE bookings SET respond_by = NOW() - INTERVAL '1 minute' WHERE id = $1", [booking.id]);

    const result = await expireStaleRequests();
    assert.ok(result.expired >= 1);

    const res = await request(port, 'GET', '/api/v1/bookings/' + booking.id, cAuth);
    assert.equal(res.body.data.status, 'cancelled');
    assert.equal(res.body.data.cancellation.by, 'system');
    assert.match(res.body.data.cancellation.reason, /did not respond/i);
  });
});
