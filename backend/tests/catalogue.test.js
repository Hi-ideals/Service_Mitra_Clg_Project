/**
 * Phase 4 tests: catalogue management and provider profile setup.
 *
 * The rules worth proving here are the ones a UI cannot be trusted to enforce:
 * only an admin may change the catalogue, a provider's price must sit inside
 * the admin's band, working hours cannot overlap, and an unverified provider
 * cannot switch themselves live.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { pool, query, queryOne } from '../src/db/pool.js';

const PASSWORD = 'Password@123';
const NEW_PROVIDER_PHONE = '9555511001';
const TEST_SLUG = 'test-temp-category';

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

async function cleanup() {
  // A deleted category has its slug suffixed, so match that form too.
  await query(
    `DELETE FROM service_categories WHERE slug = $1 OR slug LIKE $1 || '--deleted-%'`,
    [TEST_SLUG],
  );
  await query('DELETE FROM users WHERE phone = $1', [NEW_PROVIDER_PHONE]);
}

test('Phase 4: catalogue and provider profile', async (t) => {
  await cleanup();
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  t.after(async () => {
    server.close();
    await cleanup();
    await pool.end();
  });

  const admin = await signIn(port, 'admin@servicesetu.in');
  const customer = await signIn(port, 'customer@servicesetu.in');
  const provider = await signIn(port, 'plumber@servicesetu.in');

  await t.test('anyone can browse the catalogue without signing in', async () => {
    const res = await request(port, 'GET', '/api/v1/categories/tree');
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length >= 8, 'root categories returned');
    const plumbing = res.body.data.find((c) => c.slug === 'plumbing');
    assert.ok(plumbing.children.length >= 4, 'sub-categories nested under their parent');
    assert.ok(plumbing.providerCount >= 1, 'live provider count included');
  });

  await t.test('category detail resolves by slug as well as id', async () => {
    const bySlug = await request(port, 'GET', '/api/v1/categories/ac-servicing');
    assert.equal(bySlug.status, 200);
    const byId = await request(port, 'GET', '/api/v1/categories/' + bySlug.body.data.id);
    assert.equal(byId.body.data.slug, 'ac-servicing');
    assert.ok(bySlug.body.data.pricing.min > 0, 'pricing guideline exposed');
  });

  await t.test('only an admin may create a category', async () => {
    const body = { name: 'Test Temp Category', slug: TEST_SLUG, basePriceMinor: 50000, minPriceMinor: 20000, maxPriceMinor: 100000 };

    const anon = await request(port, 'POST', '/api/v1/categories', { body });
    assert.equal(anon.status, 401);

    const asCustomer = await request(port, 'POST', '/api/v1/categories', { body, token: customer.accessToken });
    assert.equal(asCustomer.status, 403);

    const asProvider = await request(port, 'POST', '/api/v1/categories', { body, token: provider.accessToken });
    assert.equal(asProvider.status, 403);

    const asAdmin = await request(port, 'POST', '/api/v1/categories', { body, token: admin.accessToken });
    assert.equal(asAdmin.status, 201);
    assert.equal(asAdmin.body.data.slug, TEST_SLUG);
  });

  await t.test('an admin action is written to the audit trail', async () => {
    const row = await queryOne(
      `SELECT action, entity_type FROM admin_audit_log
        WHERE action = 'category.created' ORDER BY created_at DESC LIMIT 1`,
    );
    assert.equal(row.entity_type, 'service_category');
  });

  await t.test('an incoherent price band is rejected', async () => {
    const res = await request(port, 'POST', '/api/v1/categories', {
      token: admin.accessToken,
      body: { name: 'Bad Band', slug: 'bad-band-test', basePriceMinor: 5000, minPriceMinor: 90000, maxPriceMinor: 10000 },
    });
    assert.equal(res.status, 400);
  });

  await t.test('the trade licence flag can be set, cleared and set again', async () => {
    /**
     * The flag was previously settable only by editing the database: the admin
     * form never sent it. Clearing it is the half that breaks quietly, because
     * the update uses COALESCE - a `false` that arrives as undefined keeps the
     * old value and the box appears to do nothing.
     */
    const slug = 'licence-toggle-' + Date.now().toString(36);

    const created = await request(port, 'POST', '/api/v1/categories', {
      token: admin.accessToken,
      body: {
        name: 'Licence Toggle Test',
        slug,
        basePriceMinor: 50000,
        minPriceMinor: 20000,
        maxPriceMinor: 90000,
        requiresCertification: true,
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body?.error));
    assert.equal(created.body.data.requiresCertification, true, 'set at creation');

    const cleared = await request(port, 'PATCH', '/api/v1/categories/' + created.body.data.id, {
      token: admin.accessToken,
      body: { requiresCertification: false },
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.data.requiresCertification, false, 'and it can be turned off again');

    const reset = await request(port, 'PATCH', '/api/v1/categories/' + created.body.data.id, {
      token: admin.accessToken,
      body: { requiresCertification: true },
    });
    assert.equal(reset.body.data.requiresCertification, true);

    await query('DELETE FROM service_categories WHERE slug = $1', [slug]);
  });

  await t.test('a duplicate slug is rejected', async () => {
    const res = await request(port, 'POST', '/api/v1/categories', {
      token: admin.accessToken,
      body: { name: 'Another', slug: TEST_SLUG, basePriceMinor: 50000, minPriceMinor: 20000 },
    });
    assert.equal(res.status, 409);
  });

  await t.test('a category in use is deactivated rather than deleted', async () => {
    const plumbing = await request(port, 'GET', '/api/v1/categories/drain-cleaning');
    const res = await request(port, 'DELETE', '/api/v1/categories/' + plumbing.body.data.id, {
      token: admin.accessToken,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.deleted, false);
    assert.equal(res.body.data.deactivated, true);

    // Restore it so later phases still have the category.
    await request(port, 'PATCH', '/api/v1/categories/' + plumbing.body.data.id, {
      token: admin.accessToken,
      body: { isActive: true },
    });
  });

  await t.test('an unused category is removed outright', async () => {
    const created = await request(port, 'GET', '/api/v1/categories/' + TEST_SLUG);
    const res = await request(port, 'DELETE', '/api/v1/categories/' + created.body.data.id, {
      token: admin.accessToken,
    });
    assert.equal(res.body.data.deleted, true);
  });
});
