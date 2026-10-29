/**
 * Phase 5 tests: KYC submission, document handling and the admin review gate.
 *
 * The claims worth proving: a KYC document is unreachable without a valid,
 * unexpired signature; an admin cannot approve a submission with missing
 * documents; approval is what makes a provider able to go live; and rejection
 * or suspension takes them offline immediately.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db/pool.js';
import * as storage from '../src/storage/storage.service.js';
import { ensureDirectories } from '../src/storage/storage.service.js';
import { registerAndConfirm } from './helpers/signup.js';

const PASSWORD = 'Password@123';
const PHONE = '9555522001';

/** Smallest valid PNG, so the magic-byte check has something real to accept. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

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
function upload(port, path, { token, docType, filename, content, contentType }) {
  return new Promise((resolve, reject) => {
    const boundary = '----servicesetu' + Date.now();
    const head = Buffer.from(
      '--' + boundary + '\r\nContent-Disposition: form-data; name="docType"\r\n\r\n' + docType + '\r\n' +
      '--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + filename + '"\r\n' +
      'Content-Type: ' + contentType + '\r\n\r\n',
    );
    const tail = Buffer.from('\r\n--' + boundary + '--\r\n');
    const payload = Buffer.concat([head, content, tail]);

    const req = http.request({
      host: '127.0.0.1', port, method: 'POST', path,
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': payload.length,
        Authorization: 'Bearer ' + token,
      },
    }, (res) => {
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
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

const signIn = async (port, identifier) =>
  (await request(port, 'POST', '/api/v1/auth/login', { body: { identifier, password: PASSWORD } })).body.data;

const cleanup = () => query('DELETE FROM users WHERE phone = $1', [PHONE]);

test('Phase 5: verification and KYC', async (t) => {
  await cleanup();
  await ensureDirectories();
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  t.after(async () => {
    server.close();
    await cleanup();
    await pool.end();
  });

  const admin = await signIn(port, 'admin@servicesetu.in');
  const adminAuth = { token: admin.accessToken };

  const registered = await registerAndConfirm(request, port, {
    role: 'provider',
    fullName: 'Kyc Candidate',
    email: 'kyc.candidate@test.local',
    phone: PHONE,
    password: PASSWORD,
  });
  const provider = { token: registered.body.data.accessToken };
  let submissionId = null;
  let documentUrl = null;
  let storageKey = null;

  const KYC_DETAILS = {
    fullLegalName: 'Kyc Candidate Kumar',
    dateOfBirth: '1992-04-15',
    idProofType: 'aadhaar',
    idProofLast4: '4321',
    addressLine: '45 Station Road',
    city: 'Bidar',
    state: 'Karnataka',
    pincode: '585401',
  };

  await t.test('a new provider starts unsubmitted', async () => {
    const res = await request(port, 'GET', '/api/v1/kyc/me', provider);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'unsubmitted');
    // Aadhaar and a photograph only. An Aadhaar already carries the address,
    // so a second document proving it is friction rather than assurance.
    assert.deepEqual(res.body.data.requiredDocuments, ['identity', 'photo']);
  });

  await t.test('an under-age applicant is rejected', async () => {
    const res = await request(port, 'POST', '/api/v1/kyc/me', {
      ...provider,
      body: { ...KYC_DETAILS, dateOfBirth: '2015-01-01' },
    });
    assert.equal(res.status, 422);
  });

  await t.test('submitting moves the provider to pending review', async () => {
    const res = await request(port, 'POST', '/api/v1/kyc/me', { ...provider, body: KYC_DETAILS });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.status, 'pending');
    submissionId = res.body.data.id;

    const profile = await request(port, 'GET', '/api/v1/providers/me', provider);
    assert.equal(profile.body.data.verificationStatus, 'pending');
  });

  await t.test('only the last four digits of the ID number are stored', async () => {
    const res = await request(port, 'GET', '/api/v1/kyc/me', provider);
    const serialised = JSON.stringify(res.body.data);
    assert.equal(res.body.data.submission.idProofLast4, '4321');
    assert.ok(!serialised.includes('storage_key'), 'raw storage keys are never exposed');
  });

  await t.test('a file whose contents do not match its type is rejected', async () => {
    const res = await upload(port, '/api/v1/kyc/me/documents', {
      token: provider.token, docType: 'identity',
      filename: 'fake.png', content: Buffer.from('<script>alert(1)</script>'),
      contentType: 'image/png',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /does not look like a real PNG/i);
  });

  await t.test('an executable disguised by extension is rejected', async () => {
    const res = await upload(port, '/api/v1/kyc/me/documents', {
      token: provider.token, docType: 'identity',
      filename: 'payload.exe', content: PNG, contentType: 'application/x-msdownload',
    });
    assert.equal(res.status, 400);
  });

  await t.test('a genuine document uploads and comes back as a signed URL', async () => {
    const res = await upload(port, '/api/v1/kyc/me/documents', {
      token: provider.token, docType: 'identity',
      filename: 'aadhaar.png', content: PNG, contentType: 'image/png',
    });
    assert.equal(res.status, 201);
    assert.match(res.body.data.url, /^\/api\/v1\/files\?key=/);
    assert.ok(res.body.data.url.includes('signature='), 'URL carries a signature');
    documentUrl = res.body.data.url;
    storageKey = new URLSearchParams(documentUrl.split('?')[1]).get('key');
  });

  await t.test('the document is unreachable without a valid signature', async () => {
    const params = new URLSearchParams(documentUrl.split('?')[1]);

    const noSig = await raw(port, '/api/v1/files?key=' + encodeURIComponent(params.get('key')));
    assert.equal(noSig.status, 422, 'a bare storage key is not enough');

    const badSig = await raw(
      port,
      '/api/v1/files?key=' + encodeURIComponent(params.get('key')) +
        '&expires=' + params.get('expires') + '&signature=' + 'a'.repeat(64),
    );
    assert.equal(badSig.status, 403, 'a forged signature is refused');

    const expired = await raw(
      port,
      '/api/v1/files?key=' + encodeURIComponent(params.get('key')) +
        '&expires=1000000000&signature=' + params.get('signature'),
    );
    assert.equal(expired.status, 403, 'an old expiry cannot be replayed');
  });

  await t.test('a valid signed URL serves the file as what it actually is', async () => {
    const res = await raw(port, documentUrl);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/png', 'served as a PNG, not as unnamed bytes');
    assert.match(
      res.headers['content-disposition'],
      /^inline; filename="aadhaar\.png"$/,
      'an image opens in the reviewer tab under its own name',
    );
    assert.equal(res.headers['cache-control'], 'private, no-store');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.ok(res.body.equals(PNG), 'the stored bytes come back unchanged');
  });

  await t.test('the content type cannot be swapped for one the browser would execute', async () => {
    const params = new URLSearchParams(documentUrl.split('?')[1]);
    params.set('ct', 'text/html');

    const res = await raw(port, '/api/v1/files?' + params.toString());
    assert.equal(res.status, 403, 'the type is part of the signature, so tampering breaks it');
  });

  await t.test('a type outside the renderable list is handed back as an opaque download', async () => {
    // Signed correctly, but naming a type no browser should be told to render.
    const signed = storage.signedUrl(storageKey, {
      contentType: 'image/svg+xml',
      filename: 'trap.svg',
    });

    const res = await raw(port, signed);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/octet-stream');
    assert.match(res.headers['content-disposition'], /^attachment;/);
  });

  await t.test('a provider cannot see the admin review queue', async () => {
    const res = await request(port, 'GET', '/api/v1/admin/kyc', provider);
    assert.equal(res.status, 403);
  });

  await t.test('the submission appears in the admin queue, oldest first', async () => {
    const res = await request(port, 'GET', '/api/v1/admin/kyc', adminAuth);
    assert.equal(res.status, 200);
    const mine = res.body.data.find((s) => s.id === submissionId);
    assert.ok(mine, 'submission is queued for review');
    assert.equal(mine.status, 'pending');
    assert.equal(mine.documentCount, 1);
    assert.equal(typeof mine.waitingDays, 'number');
  });

  await t.test('approval is refused while a required document is missing', async () => {
    const res = await request(port, 'POST', '/api/v1/admin/kyc/' + submissionId + '/approve', {
      ...adminAuth, body: {},
    });
    assert.equal(res.status, 400);
    // Names the missing document, in words an admin can act on.
    assert.match(res.body.error.message, /a photograph/i);
    assert.doesNotMatch(
      res.body.error.message,
      /address proof/i,
      'an address proof is no longer compulsory, so it must not be demanded here',
    );
  });

  await t.test('the admin can ask for more information instead of deciding', async () => {
    const res = await request(port, 'POST', '/api/v1/admin/kyc/' + submissionId + '/request-info', {
      ...adminAuth, body: { message: 'Please upload a clear address proof document.' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.providerStatus, 'info_requested');

    const inbox = await request(port, 'GET', '/api/v1/kyc/me', provider);
    assert.equal(inbox.body.data.status, 'info_requested');
    assert.equal(inbox.body.data.canSubmit, true, 'the provider may respond');
  });

  await t.test('the provider uploads the missing documents and is approved', async () => {
    const uploaded = await upload(port, '/api/v1/kyc/me/documents', {
      token: provider.token, docType: 'address',
      filename: 'bill.png', content: PNG, contentType: 'image/png',
    });
    assert.equal(uploaded.status, 201);

    // A photograph is required too: the admin checks the face against the
    // identity document, and the customer sees who is coming.
    const portrait = await upload(port, '/api/v1/kyc/me/documents', {
      token: provider.token, docType: 'photo',
      filename: 'portrait.png', content: PNG, contentType: 'image/png',
    });
    assert.equal(portrait.status, 201);

    const res = await request(port, 'POST', '/api/v1/admin/kyc/' + submissionId + '/approve', {
      ...adminAuth, body: { notes: 'Documents verified against the register.' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.providerStatus, 'approved');
  });

  await t.test('approval is what lets the provider go live', async () => {
    const refreshed = await request(port, 'POST', '/api/v1/auth/login', {
      body: { identifier: PHONE, password: PASSWORD },
    });
    const fresh = { token: refreshed.body.data.accessToken };
    assert.equal(refreshed.body.data.user.verificationStatus, 'approved');

    // Still needs a service, an area and hours before going online.
    const incomplete = await request(port, 'PATCH', '/api/v1/providers/me/status', {
      ...fresh, body: { isAcceptingBookings: true },
    });
    assert.equal(incomplete.status, 400);
    assert.equal(incomplete.body.error.code, 'PROFILE_INCOMPLETE');

    const category = (await request(port, 'GET', '/api/v1/categories/furniture-repair')).body.data;
    await request(port, 'PATCH', '/api/v1/providers/me', { ...fresh, body: { headline: 'Now verified' } });
    await request(port, 'PUT', '/api/v1/providers/me/services', {
      ...fresh, body: { categoryId: category.id, priceMinor: 45000 },
    });
    await request(port, 'POST', '/api/v1/providers/me/areas', {
      ...fresh, body: { city: 'Bidar', state: 'Karnataka', pincodes: ['585401'], radiusKm: 10 },
    });
    await request(port, 'PUT', '/api/v1/providers/me/schedule', {
      ...fresh,
      body: { windows: [{ dayOfWeek: 1, startTime: '09:00', endTime: '18:00' }] },
    });

    const live = await request(port, 'PATCH', '/api/v1/providers/me/status', {
      ...fresh, body: { isAcceptingBookings: true },
    });
    assert.equal(live.status, 200);
    assert.equal(live.body.data.isDiscoverable, true);
  });

  await t.test('an approved provider cannot silently re-submit different KYC details', async () => {
    const res = await request(port, 'POST', '/api/v1/kyc/me', {
      ...provider,
      body: { ...KYC_DETAILS, fullLegalName: 'Someone Else Entirely' },
    });
    assert.equal(res.status, 409);
  });

  await t.test('suspension takes the provider offline immediately', async () => {
    const providerId = (await request(port, 'GET', '/api/v1/admin/kyc/' + submissionId, adminAuth))
      .body.data.providerId;

    const res = await request(port, 'PATCH', '/api/v1/admin/kyc/providers/' + providerId + '/status', {
      ...adminAuth, body: { status: 'suspended', reason: 'Repeated no-shows reported by customers' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.verificationStatus, 'suspended');
    assert.equal(res.body.data.isAcceptingBookings, false, 'suspension forces them offline');

    const reinstated = await request(port, 'PATCH', '/api/v1/admin/kyc/providers/' + providerId + '/status', {
      ...adminAuth, body: { status: 'approved', reason: 'Issue resolved after review' },
    });
    assert.equal(reinstated.body.data.verificationStatus, 'approved');
  });

  await t.test('every decision is recorded in the review history and audit log', async () => {
    const detail = await request(port, 'GET', '/api/v1/admin/kyc/' + submissionId, adminAuth);
    const transitions = detail.body.data.history.map((h) => h.to_status);
    assert.ok(transitions.includes('pending'));
    assert.ok(transitions.includes('info_requested'));
    assert.ok(transitions.includes('approved'));

    const { rows } = await pool.query(
      `SELECT action FROM admin_audit_log WHERE entity_id = $1 ORDER BY created_at`,
      [submissionId],
    );
    const actions = rows.map((r) => r.action);
    assert.ok(actions.includes('provider.approved'), 'approval is attributable to an admin');
  });
});
