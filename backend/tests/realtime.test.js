/**
 * Phase 8 tests: the live status stream.
 *
 * Proves an open SSE connection receives transitions as they happen, that it
 * opens with a snapshot so a late joiner is not left blank, and that it is not
 * a way around the participant check.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { pool, query, queryOne } from '../src/db/pool.js';

const PASSWORD = 'Password@123';
const TAG = 'phase8-sse';

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

/** Opens an SSE connection and collects parsed events as they arrive. */
function openStream(port, path, token) {
  return new Promise((resolve, reject) => {
    const events = [];
    let buffer = '';

    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        path,
        headers: { Authorization: 'Bearer ' + token, Accept: 'text/event-stream' },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve({ status: res.statusCode, events, close: () => req.destroy() });
        }

        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buffer += chunk;
          const frames = buffer.split('\n\n');
          buffer = frames.pop();
          for (const frame of frames) {
            const name = /^event: (.+)$/m.exec(frame);
            const data = /^data: (.+)$/m.exec(frame);
            if (name && data) events.push({ event: name[1], data: JSON.parse(data[1]) });
          }
        });

        return resolve({ status: 200, headers: res.headers, events, close: () => req.destroy() });
      },
    );

    req.on('error', reject);
  });
}

const waitFor = (events, name, timeoutMs = 3000) =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = setInterval(() => {
      const found = events.find((e) => e.event === name);
      if (found) {
        clearInterval(tick);
        resolve(found);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(tick);
        reject(new Error('Timed out waiting for ' + name + '. Saw: ' + events.map((e) => e.event).join(', ')));
      }
    }, 25);
  });

const signIn = async (port, identifier) =>
  (await request(port, 'POST', '/api/v1/auth/login', { body: { identifier, password: PASSWORD } })).body.data;

const cleanup = () => query('DELETE FROM bookings WHERE description = $1', [TAG]);

function futureSlot(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
}

test('Phase 8: live status stream', async (t) => {
  await cleanup();
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const open = [];
  t.after(async () => {
    open.forEach((s) => s.close());
    server.close();
    await cleanup();
    await pool.end();
  });

  const customer = await signIn(port, 'customer@servicesetu.in');
  const providerLogin = await signIn(port, 'plumber@servicesetu.in');
  const outsider = await signIn(port, 'electrician@servicesetu.in');
  const cAuth = { token: customer.accessToken };
  const pAuth = { token: providerLogin.accessToken };

  const provider = await queryOne(
    "SELECT p.id FROM provider_profiles p JOIN users u ON u.id = p.user_id WHERE u.email = 'plumber@servicesetu.in'",
  );
  const category = (await request(port, 'GET', '/api/v1/categories/tap-mixer-repair')).body.data;

  const created = await request(port, 'POST', '/api/v1/bookings', {
    ...cAuth,
    body: {
      providerId: provider.id,
      categoryId: category.id,
      scheduledStart: futureSlot(20),
      address: { line: '12 MG Road', city: 'Bidar', state: 'Karnataka', pincode: '585401' },
      description: TAG,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body ? created.body.error : ''));
  const bookingId = created.body.data.id;

  await request(port, 'POST', '/api/v1/bookings/' + bookingId + '/accept', pAuth);
  await query(
    "UPDATE bookings SET scheduled_start = NOW(), scheduled_end = NOW() + INTERVAL '45 minutes' WHERE id = $1",
    [bookingId],
  );

  await t.test('the stream opens with the right headers and a snapshot', async () => {
    const stream = await openStream(port, '/api/v1/bookings/' + bookingId + '/stream', customer.accessToken);
    open.push(stream);

    assert.equal(stream.status, 200);
    assert.match(stream.headers['content-type'], /text\/event-stream/);
    assert.match(stream.headers['cache-control'], /no-cache/);
    assert.equal(stream.headers['x-accel-buffering'], 'no', 'proxies must not buffer this');

    const snapshot = await waitFor(stream.events, 'snapshot');
    assert.equal(snapshot.data.bookingId, bookingId);
    assert.equal(snapshot.data.status, 'accepted');
  });

  await t.test('a transition reaches the open connection', async () => {
    const stream = open[0];
    const started = await request(port, 'POST', '/api/v1/bookings/' + bookingId + '/start', pAuth);
    assert.equal(started.status, 200);

    const event = await waitFor(stream.events, 'booking.started');
    assert.equal(event.data.status, 'in_progress');
    assert.equal(event.data.reference, created.body.data.reference);
  });

  await t.test('both sides of the booking receive the same event', async () => {
    const providerStream = await openStream(
      port, '/api/v1/bookings/' + bookingId + '/stream', providerLogin.accessToken,
    );
    open.push(providerStream);
    await waitFor(providerStream.events, 'snapshot');

    const customerStream = open[0];
    const code = await request(port, 'POST', '/api/v1/bookings/' + bookingId + '/completion-code', {
      ...pAuth, body: {},
    });
    assert.equal(code.status, 200);

    const toCustomer = await waitFor(customerStream.events, 'booking.completion_requested');
    const toProvider = await waitFor(providerStream.events, 'booking.completion_requested');
    assert.equal(toCustomer.data.bookingId, toProvider.data.bookingId);
  });

  await t.test('an outsider cannot subscribe', async () => {
    const stream = await openStream(
      port, '/api/v1/bookings/' + bookingId + '/stream', outsider.accessToken,
    );
    open.push(stream);
    assert.equal(stream.status, 403, 'the participant check applies to the stream too');
  });

  await t.test('an unauthenticated subscriber is refused', async () => {
    const status = await new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port, path: '/api/v1/bookings/' + bookingId + '/stream' }, (r) => {
        r.resume();
        resolve(r.statusCode);
      });
    });
    assert.equal(status, 401);
  });
});
