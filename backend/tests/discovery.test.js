/**
 * Phase 6 tests: provider discovery and search.
 *
 * The central claim is that discovery is structurally safe - an unverified,
 * offline or suspended provider cannot appear in results no matter what
 * filters are passed. The rest covers ranking, geo filtering and the public
 * profile's slot generation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { pool, query, queryOne } from '../src/db/pool.js';

const BIDAR = { lat: 17.9104, lng: 77.5199 };

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

const get = (port, path) => request(port, 'GET', path);

test('Phase 6: discovery and search', async (t) => {
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const plumber = await queryOne(
    "SELECT p.id FROM provider_profiles p JOIN users u ON u.id = p.user_id WHERE u.email = 'plumber@servicesetu.in'",
  );

  // Restore any provider this suite takes offline, whatever happens.
  t.after(async () => {
    await query(
      "UPDATE provider_profiles SET verification_status = 'approved', is_accepting_bookings = TRUE WHERE id = $1",
      [plumber.id],
    );
    server.close();
    await pool.end();
  });

  await t.test('search is public and returns seeded providers', async () => {
    const res = await get(port, '/api/v1/providers/search');
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length >= 4, 'seeded providers are discoverable');
    assert.ok(res.body.meta.total >= 4);
  });

  await t.test('results carry what a listing card needs', async () => {
    const res = await get(port, '/api/v1/providers/search?limit=1');
    const p = res.body.data[0];
    assert.ok(p.name);
    assert.ok(p.categories.length >= 1, 'categories served');
    assert.equal(typeof p.fromPriceMinor, 'number');
    assert.equal(typeof p.rating.average, 'number');
    assert.equal(typeof p.rating.isNew, 'boolean');
    assert.ok(p.verifiedAt, 'only verified providers are returned');
  });

  await t.test('filtering by category slug works', async () => {
    const res = await get(port, '/api/v1/providers/search?categorySlug=ac-repair-service');
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length >= 1);
    assert.ok(
      res.body.data.every((p) => p.categories.some((c) => /AC/i.test(c))),
      'every result actually offers an AC service',
    );
  });

  await t.test('an unknown category slug is a clean 404', async () => {
    const res = await get(port, '/api/v1/providers/search?categorySlug=not-a-real-category');
    assert.equal(res.status, 404);
  });

  await t.test('pincode filtering restricts to providers who cover it', async () => {
    const covered = await get(port, '/api/v1/providers/search?pincode=585404');
    const notCovered = await get(port, '/api/v1/providers/search?pincode=110001');
    assert.ok(covered.body.meta.total >= 1, 'a covered pincode returns providers');
    assert.equal(notCovered.body.meta.total, 0, 'an uncovered pincode returns nobody');
  });

  await t.test('geo search returns distance and respects the radius', async () => {
    const near = await get(
      port,
      '/api/v1/providers/search?lat=' + BIDAR.lat + '&lng=' + BIDAR.lng + '&sort=distance',
    );
    assert.equal(near.status, 200);
    assert.ok(near.body.data.length >= 1);
    assert.equal(typeof near.body.data[0].distanceKm, 'number');

    const distances = near.body.data.map((p) => p.distanceKm);
    assert.deepEqual(distances, [...distances].sort((a, b) => a - b), 'nearest first');

    const far = await get(port, '/api/v1/providers/search?lat=19.0760&lng=72.8777');
    assert.equal(far.body.meta.total, 0, 'nobody covers Mumbai');
  });

  await t.test('lat without lng is rejected rather than silently ignored', async () => {
    const res = await get(port, '/api/v1/providers/search?lat=17.9');
    assert.equal(res.status, 422);
  });

  await t.test('sorting by distance without coordinates is rejected', async () => {
    const res = await get(port, '/api/v1/providers/search?sort=distance');
    assert.equal(res.status, 422);
  });

  await t.test('price sorting is honoured in both directions', async () => {
    const low = await get(port, '/api/v1/providers/search?sort=price_low');
    const asc = low.body.data.map((p) => p.fromPriceMinor);
    assert.deepEqual(asc, [...asc].sort((a, b) => a - b));

    const high = await get(port, '/api/v1/providers/search?sort=price_high');
    const desc = high.body.data.map((p) => p.fromPriceMinor);
    assert.deepEqual(desc, [...desc].sort((a, b) => b - a));
  });

  await t.test('a price ceiling excludes providers above it', async () => {
    const res = await get(port, '/api/v1/providers/search?maxPriceMinor=30000');
    assert.ok(res.body.data.every((p) => p.fromPriceMinor <= 30000));
  });

  await t.test('an inverted price range is rejected', async () => {
    const res = await get(port, '/api/v1/providers/search?minPriceMinor=50000&maxPriceMinor=1000');
    assert.equal(res.status, 422);
  });

  await t.test('a minimum rating filter is applied', async () => {
    const res = await get(port, '/api/v1/providers/search?minRating=4.6');
    assert.ok(res.body.data.length >= 1);
    assert.ok(res.body.data.every((p) => p.rating.average >= 4.6));
  });

  await t.test('keyword search matches category names and skills', async () => {
    const byCategory = await get(port, '/api/v1/providers/search?q=plumb');
    assert.ok(byCategory.body.meta.total >= 1, 'category name matched');

    const bySkill = await get(port, '/api/v1/providers/search?q=' + encodeURIComponent('Gas refill'));
    assert.ok(bySkill.body.meta.total >= 1, 'skill matched');
  });

  await t.test('relevance ranking orders by score, descending', async () => {
    const res = await get(port, '/api/v1/providers/search?lat=' + BIDAR.lat + '&lng=' + BIDAR.lng);
    const scores = res.body.data.map((p) => p.relevanceScore);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
    assert.ok(scores[0] > 0 && scores[0] <= 1, 'score is normalised');
  });

  // ---------- the verification gate ----------

  await t.test('an offline provider disappears from every result', async () => {
    const before = await get(port, '/api/v1/providers/search?categorySlug=plumbing');
    const wasListed = before.body.data.some((p) => p.id === plumber.id);
    assert.equal(wasListed, true, 'the plumber starts out discoverable');

    await query('UPDATE provider_profiles SET is_accepting_bookings = FALSE WHERE id = $1', [plumber.id]);

    const after = await get(port, '/api/v1/providers/search?categorySlug=plumbing');
    assert.equal(after.body.data.some((p) => p.id === plumber.id), false);

    await query('UPDATE provider_profiles SET is_accepting_bookings = TRUE WHERE id = $1', [plumber.id]);
  });

  await t.test('a suspended provider is unreachable even by direct id', async () => {
    const listed = await get(port, '/api/v1/providers/' + plumber.id);
    assert.equal(listed.status, 200, 'reachable while approved');

    await query(
      "UPDATE provider_profiles SET verification_status = 'suspended' WHERE id = $1",
      [plumber.id],
    );

    const search = await get(port, '/api/v1/providers/search?categorySlug=plumbing');
    assert.equal(search.body.data.some((p) => p.id === plumber.id), false, 'gone from search');

    const direct = await get(port, '/api/v1/providers/' + plumber.id);
    assert.equal(direct.status, 404, 'the profile URL stops working too');

    await query(
      "UPDATE provider_profiles SET verification_status = 'approved' WHERE id = $1",
      [plumber.id],
    );
  });

  await t.test('filters cannot be used to surface an unverified provider', async () => {
    await query(
      "UPDATE provider_profiles SET verification_status = 'pending' WHERE id = $1",
      [plumber.id],
    );

    const attempts = [
      '/api/v1/providers/search?minRating=0',
      '/api/v1/providers/search?q=Patil',
      '/api/v1/providers/search?pincode=585401',
      '/api/v1/providers/search?lat=' + BIDAR.lat + '&lng=' + BIDAR.lng + '&radiusKm=100',
      '/api/v1/providers/search?sort=price_low&limit=50',
    ];

    for (const path of attempts) {
      const res = await get(port, path);
      assert.equal(
        res.body.data.some((p) => p.id === plumber.id),
        false,
        'unverified provider stayed hidden for ' + path,
      );
    }

    await query(
      "UPDATE provider_profiles SET verification_status = 'approved' WHERE id = $1",
      [plumber.id],
    );
  });

  // ---------- public profile ----------

  await t.test('the public profile carries services, areas and availability', async () => {
    const res = await get(port, '/api/v1/providers/' + plumber.id);
    assert.equal(res.status, 200);
    const p = res.body.data;
    assert.equal(p.isVerified, true);
    assert.ok(p.services.length >= 3);
    assert.ok(p.serviceAreas.length >= 1);
    assert.equal(p.availability.length, 7, 'a week of dates by default');
    assert.ok(p.services[0].estimatedMinutes > 0);
  });

  await t.test('contact details are withheld until a booking is accepted', async () => {
    const res = await get(port, '/api/v1/providers/' + plumber.id);
    const serialised = JSON.stringify(res.body.data);
    assert.ok(!/9000000101/.test(serialised), 'phone number absent');
    assert.ok(!/plumber@servicesetu\.in/.test(serialised), 'email absent');
  });

  await t.test('generated slots sit inside the declared working hours', async () => {
    const res = await get(port, '/api/v1/providers/' + plumber.id + '?days=14');
    assert.equal(res.body.data.availability.length, 14);

    const withSlots = res.body.data.availability.filter((d) => d.slots.length > 0);
    assert.ok(withSlots.length >= 1, 'some days are bookable');

    for (const day of withSlots) {
      for (const slot of day.slots) {
        const hour = new Date(slot.start).getHours();
        assert.ok(hour >= 9 && hour < 18, 'slot at ' + hour + ':00 is inside 09:00-18:00');
        assert.ok(new Date(slot.start).getTime() > Date.now(), 'no slots in the past');
      }
    }
  });

  await t.test('Sunday has no slots for a Monday-to-Saturday provider', async () => {
    const res = await get(port, '/api/v1/providers/' + plumber.id + '?days=14');
    const sundays = res.body.data.availability.filter((d) => d.day === 'Sunday');
    assert.ok(sundays.length >= 1);
    assert.ok(sundays.every((d) => d.slots.length === 0), 'closed on Sunday');
  });

  await t.test('a blocked date is greyed out rather than merely empty', async () => {
    // Take the date from the API's own calendar, so the test cannot disagree
    // with the server about what "three days from now" means.
    const calendar = await get(port, '/api/v1/providers/' + plumber.id + '?days=7');
    const target = calendar.body.data.availability[3].date;

    await query(
      `INSERT INTO availability_exceptions (provider_id, exception_date, is_available, reason)
       VALUES ($1, $2, FALSE, 'Family function')
       ON CONFLICT (provider_id, exception_date) DO UPDATE SET is_available = FALSE`,
      [plumber.id, target],
    );

    const res = await get(port, '/api/v1/providers/' + plumber.id + '?days=7');
    const day = res.body.data.availability.find((d) => d.date === target);
    assert.equal(day.blocked, true);
    assert.equal(day.reason, 'Family function');
    assert.equal(day.slots.length, 0);

    await query('DELETE FROM availability_exceptions WHERE provider_id = $1 AND exception_date = $2', [
      plumber.id, target,
    ]);
  });

  await t.test('featured and suggest back the landing page', async () => {
    const featured = await get(port, '/api/v1/providers/featured?limit=3');
    assert.equal(featured.status, 200);
    assert.ok(featured.body.data.length <= 3);

    const suggest = await get(port, '/api/v1/providers/suggest?q=ac');
    assert.equal(suggest.status, 200);
    assert.ok(suggest.body.data.length >= 1);
    assert.ok(suggest.body.data.every((s) => ['category', 'provider'].includes(s.type)));
  });
});
