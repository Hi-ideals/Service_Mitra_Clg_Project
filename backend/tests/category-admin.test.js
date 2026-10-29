/**
 * The admin builds the catalogue: parent categories with photos, and
 * subcategories under them.
 *
 * What is proved here is what the admin screen relies on but cannot enforce
 * itself: only a parent takes a photo, only an image is accepted, the photo is
 * actually reachable at the address the API hands back, replacing it does not
 * leave the old file behind, a deleted name can be used again, and a deploy no
 * longer puts the seeded catalogue back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db/pool.js';
import { seed } from '../src/db/seed.js';
import * as storage from '../src/storage/storage.service.js';

const PASSWORD = 'Password@123';
const PARENT_SLUG = 'test-admin-parent';
const CHILD_SLUG = 'test-admin-child';

/** Smallest valid PNG, so the magic-byte check has something real to accept. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n%test\n');

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

/** Multipart upload, hand-rolled so the suite stays dependency-free. */
function upload(port, path, { token, filename, content, contentType }) {
  return new Promise((resolve, reject) => {
    const boundary = '----servicesetu' + Date.now();
    const head = Buffer.from(
      '--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + filename + '"\r\n' +
      'Content-Type: ' + contentType + '\r\n\r\n',
    );
    const tail = Buffer.from('\r\n--' + boundary + '--\r\n');
    const payload = Buffer.concat([head, content, tail]);

    const headers = {
      'Content-Type': 'multipart/form-data; boundary=' + boundary,
      'Content-Length': payload.length,
    };
    if (token) headers.Authorization = 'Bearer ' + token;

    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function raw(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    }).on('error', reject);
  });
}

const signIn = async (port, identifier) =>
  (await request(port, 'POST', '/api/v1/auth/login', { body: { identifier, password: PASSWORD } }))
    .body.data;

async function cleanup() {
  const { rows } = await query(
    `SELECT image_url FROM service_categories WHERE slug = $1 AND image_url LIKE '/api/v1/static/%'`,
    [PARENT_SLUG],
  );
  for (const { image_url: url } of rows) {
    await storage.remove(url.slice('/api/v1/static/'.length), { isPublic: true });
  }

  // Children first: the parent link is ON DELETE RESTRICT.
  for (const slug of [CHILD_SLUG, PARENT_SLUG]) {
    await query(
      `DELETE FROM service_categories WHERE slug = $1 OR slug LIKE $1 || '--deleted-%'`,
      [slug],
    );
  }
}

test('Admin-built catalogue', async (t) => {
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

  let parent;
  let child;
  let firstPhoto;

  await t.test('an admin creates a parent category and a subcategory under it', async () => {
    const p = await request(port, 'POST', '/api/v1/categories', {
      token: admin.accessToken,
      body: { name: 'Test parent', slug: PARENT_SLUG, basePriceMinor: 50000, minPriceMinor: 20000 },
    });
    assert.equal(p.status, 201);
    parent = p.body.data;
    assert.equal(parent.parentId, null);

    const c = await request(port, 'POST', '/api/v1/categories', {
      token: admin.accessToken,
      body: {
        name: 'Test child', slug: CHILD_SLUG, parentId: parent.id,
        basePriceMinor: 50000, minPriceMinor: 20000,
      },
    });
    assert.equal(c.status, 201);
    child = c.body.data;
    assert.equal(child.parentId, parent.id);

    const tree = await request(port, 'GET', '/api/v1/categories/tree');
    const node = tree.body.data.find((n) => n.id === parent.id);
    assert.deepEqual(node.children.map((n) => n.id), [child.id], 'the child is nested under its parent');
  });

  await t.test('only an admin may upload a category photo', async () => {
    const res = await upload(port, '/api/v1/categories/' + parent.id + '/image', {
      token: customer.accessToken, filename: 'photo.png', content: PNG, contentType: 'image/png',
    });
    assert.equal(res.status, 403);

    const anon = await upload(port, '/api/v1/categories/' + parent.id + '/image', {
      filename: 'photo.png', content: PNG, contentType: 'image/png',
    });
    assert.equal(anon.status, 401);
  });

  await t.test('a parent photo is stored and served at the address the API returns', async () => {
    const res = await upload(port, '/api/v1/categories/' + parent.id + '/image', {
      token: admin.accessToken, filename: 'photo.png', content: PNG, contentType: 'image/png',
    });
    assert.equal(res.status, 200);
    firstPhoto = res.body.data.imageUrl;
    assert.match(firstPhoto, /^\/api\/v1\/static\/categories\//);

    const served = await raw(port, firstPhoto);
    assert.equal(served.status, 200);
    assert.equal(served.headers['content-type'], 'image/png');

    const tree = await request(port, 'GET', '/api/v1/categories/tree');
    assert.equal(tree.body.data.find((n) => n.id === parent.id).imageUrl, firstPhoto);
  });

  await t.test('replacing the photo removes the old file', async () => {
    const res = await upload(port, '/api/v1/categories/' + parent.id + '/image', {
      token: admin.accessToken, filename: 'second.png', content: PNG, contentType: 'image/png',
    });
    assert.equal(res.status, 200);
    assert.notEqual(res.body.data.imageUrl, firstPhoto);
    assert.equal((await raw(port, res.body.data.imageUrl)).status, 200);
    assert.equal((await raw(port, firstPhoto)).status, 404);
  });

  await t.test('a subcategory cannot take a photo', async () => {
    const res = await upload(port, '/api/v1/categories/' + child.id + '/image', {
      token: admin.accessToken, filename: 'photo.png', content: PNG, contentType: 'image/png',
    });
    assert.equal(res.status, 400);
  });

  await t.test('a PDF is refused even though KYC accepts one', async () => {
    const res = await upload(port, '/api/v1/categories/' + parent.id + '/image', {
      token: admin.accessToken, filename: 'menu.pdf', content: PDF, contentType: 'application/pdf',
    });
    assert.equal(res.status, 400);
  });

  await t.test('a deleted category frees its name for a new one', async () => {
    const del = await request(port, 'DELETE', '/api/v1/categories/' + child.id, {
      token: admin.accessToken,
    });
    assert.equal(del.body.data.deleted, true);

    const again = await request(port, 'POST', '/api/v1/categories', {
      token: admin.accessToken,
      body: {
        name: 'Test child', slug: CHILD_SLUG, parentId: parent.id,
        basePriceMinor: 50000, minPriceMinor: 20000,
      },
    });
    assert.equal(again.status, 201);
  });

  await t.test('a deployment seed no longer writes the catalogue', async () => {
    const before = await query('SELECT count(*)::int c FROM service_categories');
    const result = await seed({ catalogueOnly: true });
    const after = await query('SELECT count(*)::int c FROM service_categories');
    assert.equal(result.categoryCount, 0);
    assert.equal(after.rows[0].c, before.rows[0].c);
  });
});
