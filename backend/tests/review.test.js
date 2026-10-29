/**
 * Phase 10 tests: ratings and reviews.
 *
 * A review is only worth something if it is hard to fake, so most of this
 * suite is about who cannot leave one. The rest proves the aggregate that
 * feeds discovery ranking stays honest when moderation removes a review.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { pool, query, queryOne } from '../src/db/pool.js';

const PASSWORD = 'Password@123';
const TAG = 'phase10-test';

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

/**
 * The seeded carpenter works Monday to Friday, so this skips weekends
 * entirely rather than only Sunday.
 */
function weekdayAt(hour, daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** Reviews cascade with their booking, so only bookings need unwinding here. */
const cleanup = () => query('DELETE FROM bookings WHERE description = $1', [TAG]);

const ADDRESS = { line: '12 MG Road', city: 'Bidar', state: 'Karnataka', pincode: '585401' };

test('Phase 10: ratings and reviews', async (t) => {
  await cleanup();
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const provider = await queryOne(
    "SELECT p.id, p.rating_average, p.rating_count FROM provider_profiles p JOIN users u ON u.id = p.user_id WHERE u.email = 'carpenter@servicesetu.in'",
  );

  // The seeded aggregate is restored afterwards so other suites see the
  // fixture they expect.
  t.after(async () => {
    await cleanup();
    await query(
      'UPDATE provider_profiles SET rating_average = $2, rating_count = $3 WHERE id = $1',
      [provider.id, provider.rating_average, provider.rating_count],
    );
    server.close();
    await pool.end();
  });

  const customer = await signIn(port, 'customer@servicesetu.in');
  const providerLogin = await signIn(port, 'carpenter@servicesetu.in');
  const admin = await signIn(port, 'admin@servicesetu.in');
  const outsider = await signIn(port, 'plumber@servicesetu.in');
  const cAuth = { token: customer.accessToken };
  const pAuth = { token: providerLogin.accessToken };
  const aAuth = { token: admin.accessToken };

  const category = (await request(port, 'GET', '/api/v1/categories/furniture-repair')).body.data;

  let slotOffsetHours = 0;

  const makeBooking = (daysAhead, hour) =>
    request(port, 'POST', '/api/v1/bookings', {
      ...cAuth,
      body: {
        providerId: provider.id,
        categoryId: category.id,
        scheduledStart: weekdayAt(hour, daysAhead).toISOString(),
        address: ADDRESS,
        description: TAG,
      },
    });

  /** A booking driven to completed, ready to be reviewed. */
  async function completedBooking(daysAhead = 22, hour = 10) {
    const res = await makeBooking(daysAhead, hour);
    assert.equal(res.status, 201, JSON.stringify(res.body ? res.body.error : ''));
    const id = res.body.data.id;

    await request(port, 'POST', '/api/v1/bookings/' + id + '/accept', pAuth);
    slotOffsetHours += 2;
    await query(
      `UPDATE bookings SET scheduled_start = NOW() - ($2 || ' hours')::interval,
                           scheduled_end = NOW() - ($2 || ' hours')::interval + INTERVAL '45 minutes'
        WHERE id = $1`,
      [id, slotOffsetHours],
    );
    await request(port, 'POST', '/api/v1/bookings/' + id + '/start', pAuth);
    await request(port, 'POST', '/api/v1/bookings/' + id + '/complete', { ...cAuth, body: {} });
    return id;
  }

  let reviewedBookingId = null;
  let reviewId = null;

  await t.test('a booking that is not complete cannot be reviewed', async () => {
    const booking = await makeBooking(23, 14);
    const review = await request(port, 'POST', '/api/v1/reviews', {
      ...cAuth, body: { bookingId: booking.body.data.id, rating: 5 },
    });
    assert.equal(review.status, 409);
    assert.match(review.body.error.message, /once the job is complete/i);
  });

  await t.test('the customer of a completed booking can review it', async () => {
    reviewedBookingId = await completedBooking();

    const res = await request(port, 'POST', '/api/v1/reviews', {
      ...cAuth,
      body: {
        bookingId: reviewedBookingId,
        rating: 5,
        title: 'Excellent work',
        comment: 'Arrived on time and fixed the wardrobe properly.',
        punctuality: 5,
        quality: 5,
        behaviour: 4,
      },
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.data.review.rating, 5);
    assert.equal(res.body.data.review.subRatings.behaviour, 4);
    assert.ok(res.body.data.providerRating.count >= 1);
    reviewId = res.body.data.review.id;
  });

  await t.test('the same booking cannot be reviewed twice', async () => {
    const res = await request(port, 'POST', '/api/v1/reviews', {
      ...cAuth, body: { bookingId: reviewedBookingId, rating: 1 },
    });
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /already reviewed/i);
  });

  await t.test('someone else cannot review your booking', async () => {
    const res = await request(port, 'POST', '/api/v1/reviews', {
      token: outsider.accessToken, body: { bookingId: reviewedBookingId, rating: 5 },
    });
    assert.equal(res.status, 403);
  });

  await t.test('a rating outside 1 to 5 is rejected', async () => {
    const bookingId = await completedBooking(24, 11);
    for (const rating of [0, 6, -1]) {
      const res = await request(port, 'POST', '/api/v1/reviews', {
        ...cAuth, body: { bookingId, rating },
      });
      assert.equal(res.status, 422, 'rating ' + rating + ' rejected');
    }
  });

  await t.test('reviews close after the review window', async () => {
    const bookingId = await completedBooking(25, 12);
    await query("UPDATE bookings SET completed_at = NOW() - INTERVAL '60 days' WHERE id = $1", [bookingId]);

    const res = await request(port, 'POST', '/api/v1/reviews', {
      ...cAuth, body: { bookingId, rating: 5 },
    });
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /close 30 days/i);
  });

  // ---------- aggregates and public display ----------

  await t.test('the provider aggregate reflects the published reviews', async () => {
    const bookingId = await completedBooking(26, 13);
    await request(port, 'POST', '/api/v1/reviews', {
      ...cAuth, body: { bookingId, rating: 3, comment: 'Work was fine but arrived late.' },
    });

    const row = await queryOne(
      'SELECT rating_average, rating_count FROM provider_profiles WHERE id = $1',
      [provider.id],
    );
    const computed = await queryOne(
      "SELECT ROUND(AVG(rating)::numeric, 2) AS avg, COUNT(*)::int AS n FROM reviews WHERE provider_id = $1 AND status = 'published'",
      [provider.id],
    );

    assert.equal(Number(row.rating_average), Number(computed.avg), 'the cached average matches the reviews');
    assert.equal(row.rating_count, computed.n);
  });

  await t.test('the public review list carries a distribution summary', async () => {
    const res = await request(port, 'GET', '/api/v1/providers/' + provider.id + '/reviews');
    assert.equal(res.status, 200, 'reviews are readable without signing in');
    assert.ok(res.body.data.length >= 2);

    const summary = (await request(port, 'GET', '/api/v1/providers/' + provider.id + '/reviews/summary')).body.data;
    assert.ok(summary.average > 0);
    assert.equal(summary.count, res.body.meta.total);
    assert.equal(typeof summary.distribution['5'].percent, 'number');
    assert.ok(summary.subRatings.punctuality >= 0);
  });

  await t.test('reviews can be filtered by star rating', async () => {
    const res = await request(port, 'GET', '/api/v1/providers/' + provider.id + '/reviews?rating=3');
    assert.ok(res.body.data.every((r) => r.rating === 3));
  });

  await t.test('the new rating feeds discovery search', async () => {
    const res = await request(port, 'GET', '/api/v1/providers/search?categorySlug=carpentry');
    const listed = res.body.data.find((p) => p.id === provider.id);
    const row = await queryOne('SELECT rating_average FROM provider_profiles WHERE id = $1', [provider.id]);
    assert.equal(listed.rating.average, Number(row.rating_average), 'search shows the same figure');
  });

  // ---------- what the provider can see ----------

  /**
   * The provider's own Reviews screen reads this. Before it existed the only
   * thing a provider saw was the average on their dashboard - the words
   * behind the number were readable by every customer and by nobody who
   * could act on them.
   */
  await t.test('a provider can read the reviews written about them', async () => {
    const res = await request(port, 'GET', '/api/v1/reviews/received', pAuth);
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length > 0, 'the review just written is listed');
    assert.ok(
      res.body.data.every((r) => r.id && r.rating >= 1 && r.rating <= 5),
      'each row carries the rating',
    );
    assert.ok(res.body.data[0].bookingReference, 'and which visit it was about');
  });

  await t.test('the rating breakdown comes back with the list', async () => {
    const res = await request(port, 'GET', '/api/v1/reviews/received', pAuth);
    const { summary, total } = res.body.meta;

    assert.equal(summary.count, total, 'the summary counts the same reviews as the list');
    const spread = Object.values(summary.distribution).reduce((n, d) => n + d.count, 0);
    assert.equal(spread, total, 'every review falls into exactly one star bucket');
    assert.ok(summary.average > 0 && summary.average <= 5);
  });

  await t.test('a provider sees only their own reviews', async () => {
    const mine = await request(port, 'GET', '/api/v1/reviews/received', pAuth);
    const theirs = await request(port, 'GET', '/api/v1/reviews/received', {
      token: outsider.accessToken,
    });

    assert.equal(theirs.status, 200, 'another provider gets their own list, not a refusal');
    const overlap = mine.body.data
      .map((r) => r.id)
      .filter((id) => theirs.body.data.some((r) => r.id === id));
    assert.deepEqual(overlap, [], 'and the two lists share nothing');
  });

  await t.test('a customer cannot read a provider review list', async () => {
    const res = await request(port, 'GET', '/api/v1/reviews/received', cAuth);
    assert.equal(res.status, 403);
  });

  // ---------- provider reply ----------

  await t.test('a provider can reply once to their own review', async () => {
    const res = await request(port, 'POST', '/api/v1/reviews/' + reviewId + '/reply', {
      ...pAuth, body: { reply: 'Thank you, it was a pleasure working with you.' },
    });
    assert.equal(res.status, 200);
    assert.match(res.body.data.reply.text, /pleasure/i);

    const again = await request(port, 'POST', '/api/v1/reviews/' + reviewId + '/reply', {
      ...pAuth, body: { reply: 'Actually, let me add something else.' },
    });
    assert.equal(again.status, 409, 'a reply is a response, not a running argument');
  });

  await t.test('a provider cannot reply to someone else review', async () => {
    const res = await request(port, 'POST', '/api/v1/reviews/' + reviewId + '/reply', {
      token: outsider.accessToken, body: { reply: 'Replying to a review that is not mine.' },
    });
    assert.equal(res.status, 403);
  });

  await t.test('a customer cannot post a provider reply', async () => {
    const res = await request(port, 'POST', '/api/v1/reviews/' + reviewId + '/reply', {
      ...cAuth, body: { reply: 'Pretending to be the provider here.' },
    });
    assert.equal(res.status, 403);
  });

  // ---------- reporting and moderation ----------

  await t.test('reporting the same review twice does not double-count', async () => {
    const first = await request(port, 'POST', '/api/v1/reviews/' + reviewId + '/report', {
      ...pAuth, body: { reason: 'fake', details: 'This customer never booked with me.' },
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.data.alreadyReported, false);
    assert.equal(first.body.data.reportCount, 1);

    const second = await request(port, 'POST', '/api/v1/reviews/' + reviewId + '/report', {
      ...pAuth, body: { reason: 'fake', details: 'Reporting again to push the count up.' },
    });
    assert.equal(second.body.data.alreadyReported, true, 'one person, one report');
  });

  await t.test('a report does not hide the review on its own', async () => {
    const res = await request(port, 'GET', '/api/v1/providers/' + provider.id + '/reviews');
    assert.ok(
      res.body.data.some((r) => r.id === reviewId),
      'coordinated reports must not be able to silence an honest review',
    );
  });

  await t.test('only an admin sees the moderation queue', async () => {
    const asProvider = await request(port, 'GET', '/api/v1/admin/reviews', pAuth);
    assert.equal(asProvider.status, 403);

    const asAdmin = await request(port, 'GET', '/api/v1/admin/reviews?status=published', aAuth);
    assert.equal(asAdmin.status, 200);
    const queued = asAdmin.body.data.find((r) => r.id === reviewId);
    assert.ok(queued, 'the reported review is visible to the admin');
    assert.equal(queued.reportCount, 1);
    assert.ok(Array.isArray(queued.reports), 'the admin sees the report reasons');
  });

  await t.test('hiding a review removes it from public view and from the rating', async () => {
    const before = await queryOne(
      'SELECT rating_average, rating_count FROM provider_profiles WHERE id = $1',
      [provider.id],
    );

    const res = await request(port, 'PATCH', '/api/v1/admin/reviews/' + reviewId, {
      ...aAuth, body: { status: 'hidden', reason: 'Could not verify the booking' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.providerRating.count, before.rating_count - 1);

    const publicList = await request(port, 'GET', '/api/v1/providers/' + provider.id + '/reviews');
    assert.equal(
      publicList.body.data.some((r) => r.id === reviewId),
      false,
      'a hidden review disappears from the profile',
    );

    const row = await queryOne('SELECT rating_average FROM provider_profiles WHERE id = $1', [provider.id]);
    assert.notEqual(
      Number(row.rating_average),
      Number(before.rating_average),
      'a removed five-star review stops helping immediately',
    );
  });

  await t.test('restoring a review restores its effect on the rating', async () => {
    const res = await request(port, 'PATCH', '/api/v1/admin/reviews/' + reviewId, {
      ...aAuth, body: { status: 'published', reason: 'Booking verified after all' },
    });
    assert.equal(res.status, 200);

    const publicList = await request(port, 'GET', '/api/v1/providers/' + provider.id + '/reviews');
    assert.ok(publicList.body.data.some((r) => r.id === reviewId));
  });

  await t.test('moderation state is never exposed publicly', async () => {
    const res = await request(port, 'GET', '/api/v1/providers/' + provider.id + '/reviews');
    const sample = res.body.data[0];
    assert.equal(sample.status, undefined, 'the public does not see moderation state');
    assert.equal(sample.reportCount, undefined);
  });

  await t.test('the dashboard lists bookings still awaiting a review', async () => {
    const res = await request(port, 'GET', '/api/v1/reviews/pending', cAuth);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data));

    const mine = await request(port, 'GET', '/api/v1/reviews/mine', cAuth);
    assert.ok(mine.body.data.length >= 1);
  });
});
