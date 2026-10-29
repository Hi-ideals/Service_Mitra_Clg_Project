/**
 * Phase 8 tests: job status tracking.
 *
 * The claim that matters: a provider cannot mark a job complete on their own
 * say-so. Completion releases payment and unlocks the review, so it needs the
 * customer's code - and the amount is settled at that moment, inside the
 * category's ceiling.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { pool, query, queryOne } from '../src/db/pool.js';

const PASSWORD = 'Password@123';
const TAG = 'phase8-test';

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

test('Phase 8: job status tracking', async (t) => {
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
  const category = (await request(port, 'GET', '/api/v1/categories/tap-mixer-repair')).body.data;

  // Each startable fixture is dragged to a DIFFERENT point in the recent past,
  // so the fixtures do not overlap each other on the provider's calendar. A
  // start time in the past is fine - only starting too EARLY is blocked.
  let slotOffsetHours = 0;

  /** Creates a booking, accepts it, and optionally drags it to a startable slot. */
  async function liveBooking({ hour, daysAhead, startable = true }) {
    const res = await request(port, 'POST', '/api/v1/bookings', {
      ...cAuth,
      body: {
        providerId: provider.id,
        categoryId: category.id,
        scheduledStart: weekdayAt(hour, daysAhead).toISOString(),
        address: ADDRESS,
        description: TAG,
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body ? res.body.error : ''));
    const id = res.body.data.id;
    await request(port, 'POST', '/api/v1/bookings/' + id + '/accept', pAuth);

    if (startable) {
      slotOffsetHours += 2;
      await query(
        `UPDATE bookings
            SET scheduled_start = NOW() - ($2 || ' hours')::interval,
                scheduled_end   = NOW() - ($2 || ' hours')::interval + INTERVAL '45 minutes'
          WHERE id = $1`,
        [id, slotOffsetHours],
      );
    }
    return { id, quotedMinor: res.body.data.pricing.quotedMinor };
  }

  await t.test('a job cannot be started long before its slot', async () => {
    const booking = await liveBooking({ hour: 10, daysAhead: 6, startable: false });
    const res = await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/start', pAuth);
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /minutes before/i);
  });

  await t.test('a customer cannot start the job', async () => {
    const booking = await liveBooking({ hour: 11, daysAhead: 7 });
    const res = await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/start', cAuth);
    assert.equal(res.status, 403);
  });

  await t.test('the assigned provider can start the job at its slot', async () => {
    const booking = await liveBooking({ hour: 12, daysAhead: 8 });
    const res = await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/start', pAuth);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'in_progress');
    assert.ok(res.body.data.timestamps.startedAt);
  });

  await t.test('a provider cannot complete a job without the customer code', async () => {
    const booking = await liveBooking({ hour: 13, daysAhead: 9 });
    await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/start', pAuth);

    const noCode = await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/complete', {
      ...pAuth, body: {},
    });
    assert.equal(noCode.status, 400);
    assert.match(noCode.body.error.message, /completion code/i);

    const guessed = await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/complete', {
      ...pAuth, body: { otp: '000000' },
    });
    assert.equal(guessed.status, 400, 'a guessed code before one is issued is refused');
  });

  await t.test('the correct code completes the job and settles the money', async () => {
    const booking = await liveBooking({ hour: 14, daysAhead: 10 });
    await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/start', pAuth);

    const code = await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/completion-code', {
      ...pAuth, body: {},
    });
    assert.equal(code.status, 200);
    assert.ok(code.body.data.devCode, 'code issued to the customer');

    const wrong = await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/complete', {
      ...pAuth, body: { otp: '111111' },
    });
    assert.equal(wrong.status, 400);
    assert.match(wrong.body.error.message, /not correct/i);

    const res = await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/complete', {
      ...pAuth, body: { otp: code.body.data.devCode },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'completed');

    const pricing = res.body.data.pricing;
    assert.ok(pricing.finalMinor > 0, 'a final amount was recorded');
    assert.equal(
      pricing.commissionMinor,
      Math.round((pricing.finalMinor * pricing.commissionPercent) / 100),
      'commission is the frozen percentage of the final amount',
    );
    assert.equal(
      pricing.providerEarningMinor,
      pricing.finalMinor - pricing.commissionMinor,
      'the provider earns the remainder',
    );
    assert.ok(res.body.data.disputeWindowEndsAt, 'the dispute window opened');

    /**
     * The completion notice is what asks the customer for money, so it has
     * to leave the building. It used to be an in-app row only, which reached
     * nobody who was not already looking at the site.
     */
    const settled = (rows) => rows.length >= 2 && rows.every((r) => r.status !== 'pending');
    let notices = [];
    for (let attempt = 0; attempt < 40 && !settled(notices); attempt += 1) {
      await new Promise((r) => setTimeout(r, 100));
      notices = (await query(
        `SELECT user_id, channel, status FROM notifications
          WHERE event_type = 'booking.completed' AND entity_id = $1`,
        [booking.id],
      )).rows;
    }

    const providerUser = await queryOne(
      'SELECT user_id FROM provider_profiles WHERE id = $1', [provider.id],
    );
    const emailed = new Set(
      notices.filter((n) => n.channel === 'email' && n.status === 'sent').map((n) => n.user_id),
    );

    assert.ok(emailed.has(customer.user.id), 'the customer is emailed that payment is due');
    assert.ok(emailed.has(providerUser.user_id), 'and the professional that the job closed');
  });

  await t.test('a customer can complete their own booking without a code', async () => {
    const booking = await liveBooking({ hour: 15, daysAhead: 11 });
    await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/start', pAuth);

    const res = await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/complete', {
      ...cAuth, body: {},
    });
    assert.equal(res.status, 200, 'the code protects the customer, it does not bind them');
    assert.equal(res.body.data.status, 'completed');
  });

  await t.test('a revised final amount is honoured but capped by the category ceiling', async () => {
    const booking = await liveBooking({ hour: 16, daysAhead: 12 });
    await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/start', pAuth);

    const overCeiling = await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/completion-code', {
      ...pAuth, body: { finalAmountMinor: 9999900 },
    });
    assert.equal(overCeiling.status, 400);
    assert.match(overCeiling.body.error.message, /ceiling/i);

    const revised = booking.quotedMinor + 10000;
    const code = await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/completion-code', {
      ...pAuth, body: { finalAmountMinor: revised },
    });
    assert.equal(code.status, 200);
    assert.equal(code.body.data.amount.changedFromQuote, true, 'the customer is told the amount changed');
    assert.equal(code.body.data.amount.finalMinor, revised);

    const res = await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/complete', {
      ...pAuth, body: { otp: code.body.data.devCode, finalAmountMinor: revised },
    });
    assert.equal(res.body.data.pricing.finalMinor, revised);
  });

  await t.test('completing a job that never started is refused', async () => {
    const booking = await liveBooking({ hour: 17, daysAhead: 13 });
    const res = await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/complete', {
      ...cAuth, body: {},
    });
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /cannot be completed/i);
  });

  await t.test('the tracking view renders a progress timeline', async () => {
    const booking = await liveBooking({ hour: 9, daysAhead: 14 });

    const accepted = await request(port, 'GET', '/api/v1/bookings/' + booking.id + '/tracking', cAuth);
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.data.status, 'accepted');

    const steps = accepted.body.data.steps;
    assert.equal(steps.length, 4);
    assert.equal(steps[0].reached, true, 'requested is behind us');
    assert.equal(steps[1].current, true, 'accepted is where we are');
    assert.equal(steps[2].upcoming, true, 'in progress is ahead');
    assert.ok(accepted.body.data.provider.phone, 'the provider is contactable once accepted');

    await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/start', pAuth);
    const started = await request(port, 'GET', '/api/v1/bookings/' + booking.id + '/tracking', cAuth);
    assert.equal(started.body.data.steps[2].current, true);
    assert.ok(started.body.data.startedAt);
  });

  await t.test('a cancelled booking shows a stopped timeline rather than a fake one', async () => {
    const booking = await liveBooking({ hour: 10, daysAhead: 15, startable: false });
    await request(port, 'POST', '/api/v1/bookings/' + booking.id + '/cancel', {
      ...cAuth, body: { reason: 'No longer required, sorry' },
    });

    const res = await request(port, 'GET', '/api/v1/bookings/' + booking.id + '/tracking', cAuth);
    assert.equal(res.body.data.branchedTo, 'cancelled');
    assert.equal(res.body.data.isLive, false);
    assert.ok(res.body.data.steps.every((s) => !s.upcoming), 'nothing is still pending');
  });

  await t.test('an outsider cannot read the tracking view', async () => {
    const booking = await liveBooking({ hour: 11, daysAhead: 16, startable: false });
    const other = await signIn(port, 'electrician@servicesetu.in');
    const res = await request(port, 'GET', '/api/v1/bookings/' + booking.id + '/tracking', {
      token: other.accessToken,
    });
    assert.equal(res.status, 403);
  });
});
