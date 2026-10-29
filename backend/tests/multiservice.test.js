/**
 * Several services in one booking.
 *
 * The arithmetic is the whole point of this feature, so these assert the
 * numbers rather than that the request succeeded: the total is the sum, the
 * reserved slot grows to fit both jobs, the call-out is charged once, and the
 * commission rate lands between the two categories' rates in proportion to
 * what each service costs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { pool, query, queryOne, queryMany } from '../src/db/pool.js';

const PASSWORD = 'Password@123';
const TAG = 'multiservice-test';

function request(port, method, path, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
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

/**
 * `weekdaysAhead` weekdays from today, at `hour`.
 *
 * Counts weekdays rather than adding calendar days and then skipping forward
 * off a weekend. The old version pushed Saturday and Sunday onto the following
 * Monday, so two different offsets collapsed onto the same date - and a second
 * booking for the same provider at the same hour is refused by the overlap
 * constraint, exactly as it should be.
 *
 * That made the suite fail or pass depending on what day of the week it ran,
 * which is the worst kind of test: green on the machine you wrote it on.
 */
function weekdayAt(hour, weekdaysAhead) {
  const d = new Date();
  let remaining = weekdaysAhead;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) remaining -= 1;
  }
  d.setHours(hour, 0, 0, 0);
  return d;
}

async function cleanup() {
  await query('DELETE FROM bookings WHERE description = $1', [TAG]);
}

test('Multi-service bookings', async (t) => {
  await cleanup();
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  t.after(async () => {
    await cleanup();
    server.close();
    await pool.end();
  });

  const customer = await signIn(port, 'customer@servicesetu.in');
  const providerLogin = await signIn(port, 'electrician@servicesetu.in');
  const cAuth = { token: customer.accessToken };
  const pAuth = { token: providerLogin.accessToken };

  const provider = await queryOne(
    `SELECT p.id FROM provider_profiles p
       JOIN users u ON u.id = p.user_id
      WHERE u.email = 'electrician@servicesetu.in'`,
  );

  // Two services this provider actually publishes, with their catalogue
  // estimates and the price this provider charges for each.
  const offerings = await queryMany(
    `SELECT pc.category_id, pc.price_minor, pc.visit_charge_minor,
            c.name, c.slug, c.estimated_minutes, c.commission_percent,
            c.max_price_minor
       FROM provider_categories pc
       JOIN service_categories c ON c.id = pc.category_id
      WHERE pc.provider_id = $1 AND pc.is_active
      ORDER BY c.name`,
    [provider.id],
  );

  assert.ok(offerings.length >= 2, 'the seeded electrician must offer at least two services');

  const [a, b] = offerings;
  const address = { line: '9 Nehru Road', city: 'Bidar', state: 'Karnataka', pincode: '585401' };

  let dayOffset = 2;
  const book = (categoryIds, hour = 9) =>
    request(port, 'POST', '/api/v1/bookings', {
      ...cAuth,
      body: {
        providerId: provider.id,
        categoryIds,
        scheduledStart: weekdayAt(hour, (dayOffset += 1)).toISOString(),
        address,
        description: TAG,
      },
    });

  let twoServiceId = null;

  await t.test('the total is the sum of the chosen services', async () => {
    const res = await book([a.category_id, b.category_id]);
    assert.equal(res.status, 201, JSON.stringify(res.body?.error ?? ''));

    twoServiceId = res.body.data.id;
    const expected = Number(a.price_minor) + Number(b.price_minor);

    assert.equal(res.body.data.pricing.quotedMinor, expected);
    assert.equal(res.body.data.services.length, 2);
  });

  await t.test('the reserved slot is long enough for both jobs', async () => {
    const row = await queryOne(
      `SELECT ROUND(EXTRACT(EPOCH FROM (scheduled_end - scheduled_start)) / 60)::int AS minutes
         FROM bookings WHERE id = $1`,
      [twoServiceId],
    );
    assert.equal(row.minutes, a.estimated_minutes + b.estimated_minutes);
  });

  await t.test('no call-out fee is added - the feature was withdrawn', async () => {
    // This asserted that the highest of the chosen services' visit charges was
    // applied once. The visit charge has since been removed from the product:
    // a booking is quoted at the sum of its services and nothing else.
    //
    // The column survives because bookings taken while the charge existed
    // still carry it, and their invoices have to keep adding up.
    const row = await queryOne('SELECT visit_charge_minor FROM bookings WHERE id = $1', [twoServiceId]);
    assert.equal(Number(row.visit_charge_minor), 0, 'a new booking carries no visit charge');
  });

  await t.test('the quote is exactly the sum of the chosen services', async () => {
    const items = await queryMany(
      'SELECT price_minor FROM booking_items WHERE booking_id = $1',
      [twoServiceId],
    );
    const sum = items.reduce((total, i) => total + Number(i.price_minor), 0);

    const booking = await queryOne(
      'SELECT quoted_amount_minor, visit_charge_minor FROM bookings WHERE id = $1',
      [twoServiceId],
    );
    assert.equal(Number(booking.quoted_amount_minor), sum);
    assert.equal(
      Number(booking.quoted_amount_minor) + Number(booking.visit_charge_minor),
      sum,
      'nothing is added on top of the services',
    );
  });

  await t.test('commission is weighted by what each service costs', async () => {
    const items = await queryMany(
      'SELECT price_minor, commission_percent FROM booking_items WHERE booking_id = $1',
      [twoServiceId],
    );
    assert.equal(items.length, 2);

    const total = items.reduce((sum, i) => sum + Number(i.price_minor), 0);
    const expected = Number(
      (
        items.reduce((sum, i) => sum + Number(i.commission_percent) * Number(i.price_minor), 0) / total
      ).toFixed(2),
    );

    const booking = await queryOne('SELECT commission_percent FROM bookings WHERE id = $1', [twoServiceId]);
    assert.equal(Number(booking.commission_percent), expected);
  });

  await t.test('the headline category is the service chosen first', async () => {
    const row = await queryOne('SELECT category_id FROM bookings WHERE id = $1', [twoServiceId]);
    assert.equal(row.category_id, a.category_id);
  });

  await t.test('each service keeps its own category commission rate', async () => {
    const rows = await queryMany(
      `SELECT bi.category_id, bi.commission_percent, c.commission_percent AS catalogue
         FROM booking_items bi
         JOIN service_categories c ON c.id = bi.category_id
        WHERE bi.booking_id = $1`,
      [twoServiceId],
    );
    for (const row of rows) {
      if (row.catalogue !== null) {
        assert.equal(Number(row.commission_percent), Number(row.catalogue));
      }
    }
  });

  await t.test('the same service twice is collapsed, not charged twice', async () => {
    const res = await book([a.category_id, a.category_id, a.category_id]);
    assert.equal(res.status, 201, JSON.stringify(res.body?.error ?? ''));
    assert.equal(res.body.data.services.length, 1);
    assert.equal(res.body.data.pricing.quotedMinor, Number(a.price_minor));
  });

  await t.test('a service the provider does not offer is refused', async () => {
    const other = await queryOne(
      `SELECT id FROM service_categories
        WHERE parent_id IS NOT NULL
          AND id <> ALL($1::uuid[])
          AND id NOT IN (SELECT category_id FROM provider_categories WHERE provider_id = $2)
        LIMIT 1`,
      [[a.category_id, b.category_id], provider.id],
    );

    const res = await book([a.category_id, other.id]);
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /no longer offers|does not offer/i);
  });

  await t.test('an empty service list is refused', async () => {
    const res = await request(port, 'POST', '/api/v1/bookings', {
      ...cAuth,
      body: {
        providerId: provider.id,
        categoryIds: [],
        scheduledStart: weekdayAt(9, (dayOffset += 1)).toISOString(),
        address,
        description: TAG,
      },
    });
    assert.equal(res.status, 422);
  });

  await t.test('the older single-service shape still works', async () => {
    const res = await request(port, 'POST', '/api/v1/bookings', {
      ...cAuth,
      body: {
        providerId: provider.id,
        categoryId: b.category_id,
        scheduledStart: weekdayAt(9, (dayOffset += 1)).toISOString(),
        address,
        description: TAG,
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body?.error ?? ''));
    assert.equal(res.body.data.services.length, 1);
    assert.equal(res.body.data.pricing.quotedMinor, Number(b.price_minor));
  });

  await t.test('rescheduling keeps the full two-service duration', async () => {
    const before = await queryOne(
      `SELECT ROUND(EXTRACT(EPOCH FROM (scheduled_end - scheduled_start)) / 60)::int AS minutes
         FROM bookings WHERE id = $1`,
      [twoServiceId],
    );

    const res = await request(port, 'POST', '/api/v1/bookings/' + twoServiceId + '/reschedule', {
      ...cAuth,
      body: { scheduledStart: weekdayAt(10, (dayOffset += 1)).toISOString() },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body?.error ?? ''));

    const after = await queryOne(
      `SELECT ROUND(EXTRACT(EPOCH FROM (scheduled_end - scheduled_start)) / 60)::int AS minutes
         FROM bookings WHERE id = $1`,
      [twoServiceId],
    );

    // The regression this guards: re-validating on the headline category alone
    // shrank the slot to the first service's length and freed time the
    // provider was still committed to.
    assert.equal(after.minutes, before.minutes);
  });

  await t.test('the provider sees every service on the job', async () => {
    const res = await request(port, 'GET', '/api/v1/bookings/' + twoServiceId, pAuth);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.services.length, 2);

    const names = res.body.data.services.map((s) => s.name).sort();
    assert.deepEqual(names, [a.name, b.name].sort());
  });

  await t.test('the completion ceiling covers every service, not just the first', async () => {
    // The regression: the cap was read from the booking's headline category
    // alone, so a visit combining two capped services was held to one of their
    // caps and could not be completed even at the amount that was quoted.
    const caps = await queryOne(
      `SELECT SUM(c.max_price_minor)::bigint AS total_max,
              bool_or(c.max_price_minor IS NULL) AS uncapped
         FROM booking_items bi
         JOIN service_categories c ON c.id = bi.category_id
        WHERE bi.booking_id = $1`,
      [twoServiceId],
    );

    if (caps.uncapped) return; // nothing to assert when a service is priced on inspection

    const booking = await queryOne(
      'SELECT quoted_amount_minor, visit_charge_minor FROM bookings WHERE id = $1',
      [twoServiceId],
    );

    const combined = Number(caps.total_max) + Number(booking.visit_charge_minor ?? 0);
    const singleCap = Number(a.price_minor);

    // The quoted total must sit inside the combined ceiling - otherwise the
    // provider is quoted an amount the platform will not let them charge.
    assert.ok(
      Number(booking.quoted_amount_minor) <= combined,
      'the quoted total must be chargeable under the combined ceiling',
    );
    assert.ok(combined > singleCap, 'two capped services must raise the ceiling above one');
  });

  await t.test('a two-service job can actually be completed at its full total', async () => {
    // This is the bug, driven through the API rather than inferred from the
    // data: the completion ceiling was read from the booking's headline
    // category alone, so a visit combining a 1,000-rupee fitting and a
    // 500-rupee repair was held to a 1,000-rupee cap and could not be
    // completed even at the 1,500 the customer had already agreed.
    /*
     * The pair is chosen so the bug would actually fire: the service listed
     * first must have a cap *lower* than the two services cost together. Any
     * other pair stays under the headline cap by luck and the old code passes,
     * which is exactly how this slipped through the first time.
     */
    const pair = offerings.flatMap((x) =>
      offerings
        .filter((y) => y.category_id !== x.category_id)
        .map((y) => ({ first: x, second: y })),
    ).find(({ first, second }) =>
      first.max_price_minor !== null &&
      Number(first.price_minor) + Number(second.price_minor) > Number(first.max_price_minor));

    assert.ok(pair, 'need a pair whose total exceeds the first service cap to prove the fix');

    // A clear day and hour of its own. `weekdayAt` pushes Saturday and Sunday
    // onto the following Monday, so consecutive offsets can land on the same
    // date and collide with a slot an earlier test already reserved.
    dayOffset += 4;
    const res = await book([pair.first.category_id, pair.second.category_id], 9);
    assert.equal(res.status, 201, JSON.stringify(res.body?.error ?? ''));

    const id = res.body.data.id;
    // The full total is the services plus the visit charge. Reading only
    // `quotedMinor` left the visit charge out, so this completed for less than
    // the customer owed - which passed only because nothing held the final
    // amount at or above the quote.
    const total =
      res.body.data.pricing.quotedMinor + (res.body.data.pricing.visitChargeMinor ?? 0);

    await request(port, 'POST', '/api/v1/bookings/' + id + '/accept', pAuth);

    // Move the slot into the past so the job may be started.
    await query(
      `UPDATE bookings
          SET scheduled_start = NOW() - INTERVAL '3 hours',
              scheduled_end   = NOW() - INTERVAL '1 hour'
        WHERE id = $1`,
      [id],
    );

    const started = await request(port, 'POST', '/api/v1/bookings/' + id + '/start', pAuth);
    assert.equal(started.status, 200, JSON.stringify(started.body?.error ?? ''));

    const code = await request(port, 'POST', '/api/v1/bookings/' + id + '/completion-code', {
      ...pAuth,
      body: {},
    });
    assert.equal(code.status, 200);

    // The floor, on a booking that is still in progress: a rupee under the
    // agreed total is refused. A provider who could settle below the quote
    // could agree one figure with the customer, enter a lower one here and
    // take the difference in cash - the customer pays less and has no reason
    // to complain, and the only loser is the commission.
    const under = await request(port, 'POST', '/api/v1/bookings/' + id + '/complete', {
      ...pAuth,
      body: { otp: code.body.data.devCode, finalAmountMinor: total - 100 },
    });
    assert.equal(under.status, 400, 'settling below the quote must be refused');
    assert.match(under.body.error.message, /cannot be less than/);

    // A refused attempt must not burn the code: the honest completion below
    // has to still work, or a mistyped amount would strand the job.
    const done = await request(port, 'POST', '/api/v1/bookings/' + id + '/complete', {
      ...pAuth,
      body: { otp: code.body.data.devCode, finalAmountMinor: total },
    });

    assert.equal(done.status, 200, JSON.stringify(done.body?.error ?? ''));
    assert.equal(done.body.data.status, 'completed');
    assert.equal(done.body.data.pricing.finalMinor, total);

    /*
     * A finished job is not "happening now".
     *
     * The timeline marked the last step reached as the current one, so a
     * booking that was completed and paid for still showed a live marker and
     * "Happening now" against Completed - on both the customer's page and the
     * provider's, since both read this endpoint.
     */
    for (const auth of [cAuth, pAuth]) {
      const tracking = await request(port, 'GET', '/api/v1/bookings/' + id + '/tracking', auth);
      assert.equal(tracking.status, 200);

      const completedStep = tracking.body.data.steps.find((x) => x.status === 'completed');
      assert.equal(completedStep.reached, true, 'completed must be marked reached');
      assert.equal(completedStep.current, false, 'a finished job has no step in progress');
      assert.equal(
        tracking.body.data.steps.some((x) => x.current),
        false,
        'nothing is current once the booking is done',
      );
    }
  });

  await t.test('an admin report row names every service on the booking', async () => {
    const admin = await signIn(port, 'admin@servicesetu.in');
    const res = await request(port, 'GET', '/api/v1/admin/reports/services?limit=50', {
      token: admin.accessToken,
    });
    assert.equal(res.status, 200);

    const rows = res.body.data.rows ?? [];
    const row = rows.find((r) => r.id === twoServiceId);

    // Asserted, not skipped. An earlier version of this test looked for the
    // row under the wrong key, found nothing, returned early and passed even
    // with the fix reverted - a test that cannot fail is worse than none.
    assert.ok(row, 'the two-service booking must appear in the report');

    // The regression: the row read `bookings.category_id`, so a two-service
    // visit was reported as though only the headline service had happened.
    assert.ok(row.service.includes(a.name), 'first service named, got: ' + row.service);
    assert.ok(row.service.includes(b.name), 'second service named, got: ' + row.service);
  });

  await t.test('slots can be sized for the whole visit', async () => {
    const both = a.estimated_minutes + b.estimated_minutes;

    const short = await request(port, 'GET', '/api/v1/providers/' + provider.id + '?days=7');
    const long = await request(port, 'GET', '/api/v1/providers/' + provider.id + '?days=7&minutes=' + both);

    const count = (r) => r.body.data.availability.reduce((n, d) => n + d.slots.length, 0);

    assert.equal(short.status, 200);
    assert.equal(long.status, 200);
    // A longer visit cannot fit more times into the same working day.
    assert.ok(count(long) <= count(short), 'a longer visit must not yield more slots');
  });
});
