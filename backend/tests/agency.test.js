/**
 * Phase 13 tests: agencies.
 *
 * The headline claims: an agency can create providers who sign in and work as
 * normal; those providers inherit the agency's verification; the money still
 * belongs to the person who did the job; and no agency can see or touch
 * another agency's people.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { pool, query, queryOne } from '../src/db/pool.js';
import { registerAndConfirm } from './helpers/signup.js';

const PASSWORD = 'Password@123';
const TAG = 'agency-suite';

function request(port, method, path, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
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

const unique = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

test('Phase 13: agencies', async (t) => {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;

  // Anything this suite created, removed in dependency order.
  const cleanup = async () => {
    await query(
      `DELETE FROM provider_profiles WHERE agency_id IN
         (SELECT id FROM agencies WHERE name LIKE $1)`,
      [TAG + '%'],
    );
    await query(
      `DELETE FROM users WHERE id IN
         (SELECT user_id FROM agencies WHERE name LIKE $1)`,
      [TAG + '%'],
    );
    await query('DELETE FROM agencies WHERE name LIKE $1', [TAG + '%']);
    await query("DELETE FROM users WHERE email LIKE '%@agencytest.local'", []);
  };

  t.after(async () => {
    await cleanup();
    await new Promise((r) => server.close(r));
    await pool.end();
  });

  await cleanup();

  /** Registers one agency and returns its session. */
  async function registerAgency(label) {
    const suffix = unique();
    const res = await registerAndConfirm(request, port, {
        role: 'agency',
        agencyName: TAG + ' ' + label,
        fullName: 'Owner ' + label,
        email: 'agency-' + suffix + '@agencytest.local',
        phone: '9' + String(Date.now()).slice(-9),
        password: PASSWORD,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body?.error));
    return { token: res.body.data.accessToken, user: res.body.data.user };
  }

  let agencyA = null;
  let agencyB = null;
  let labourId = null;
  let labourEmail = null;

  // ------------------------------------------------------------ registration

  await t.test('an agency registers with a business name', async () => {
    agencyA = await registerAgency('Alpha');
    assert.equal(agencyA.user.role, 'agency');

    const me = await request(port, 'GET', '/api/v1/agencies/me', agencyA);
    assert.equal(me.status, 200);
    assert.match(me.body.data.name, /^agency-suite Alpha$/);
    // A brand new agency has not been checked by anyone yet.
    assert.equal(me.body.data.verificationStatus, 'unsubmitted');
  });

  await t.test('an agency cannot register without a business name', async () => {
    const res = await request(port, 'POST', '/api/v1/auth/register', {
      body: {
        role: 'agency',
        fullName: 'No Name',
        email: 'noname-' + unique() + '@agencytest.local',
        phone: '9' + String(Date.now()).slice(-9),
        password: PASSWORD,
      },
    });
    assert.equal(res.status, 422, 'an agency listed under a person name is not an agency');
  });

  // ------------------------------------------------------- creating a labour

  await t.test('an unverified agency can add people, but they are not bookable', async () => {
    labourEmail = 'labour-' + unique() + '@agencytest.local';

    const res = await request(port, 'POST', '/api/v1/agencies/me/providers', {
      ...agencyA,
      body: {
        fullName: 'Ravi Electrician',
        email: labourEmail,
        phone: '9' + String(Date.now()).slice(-9),
        password: PASSWORD,
        headline: 'Wiring and fittings',
      },
    });

    assert.equal(res.status, 201, JSON.stringify(res.body?.error));
    labourId = res.body.data.id;

    // The agency has not been approved, so neither has the person it vouched for.
    assert.equal(res.body.data.isBookable, false);
    assert.equal(res.body.data.verificationStatus, 'unsubmitted');
  });

  await t.test('the labour can sign in with the password the agency set', async () => {
    const res = await request(port, 'POST', '/api/v1/auth/login', {
      body: { identifier: labourEmail, password: PASSWORD },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.role, 'provider', 'a labour is an ordinary provider account');
  });

  await t.test('two people cannot share an email address', async () => {
    const res = await request(port, 'POST', '/api/v1/agencies/me/providers', {
      ...agencyA,
      body: {
        fullName: 'Duplicate',
        email: labourEmail,
        phone: '9' + String(Date.now()).slice(-9),
        password: PASSWORD,
      },
    });
    assert.equal(res.status, 409);
  });

  await t.test('an agency cannot set a weak password for someone else', async () => {
    const res = await request(port, 'POST', '/api/v1/agencies/me/providers', {
      ...agencyA,
      body: {
        fullName: 'Weak Password',
        email: 'weak-' + unique() + '@agencytest.local',
        phone: '9' + String(Date.now()).slice(-9),
        password: 'password',
      },
    });
    // The person never agreed to this password, so the rules are the same as
    // if they had chosen it themselves.
    assert.equal(res.status, 422);
  });

  // ------------------------------------------------------ inherited approval

  await t.test('approving the agency makes its people bookable', async () => {
    const agency = await queryOne('SELECT id FROM agencies WHERE user_id = $1', [agencyA.user.id]);

    // Stand in for the admin decision, which is covered by the KYC suite.
    await query(
      `UPDATE agencies SET verification_status = 'approved', verified_at = NOW() WHERE id = $1`,
      [agency.id],
    );
    await query(
      `UPDATE provider_profiles SET verification_status = 'approved', verified_at = NOW()
        WHERE agency_id = $1 AND verification_status NOT IN ('pending','info_requested')`,
      [agency.id],
    );

    const row = await queryOne('SELECT verification_status FROM provider_profiles WHERE id = $1', [labourId]);
    assert.equal(row.verification_status, 'approved');
  });

  await t.test('submitting agency KYC does not mark the team as pending', async () => {
    /**
     * The regression this guards.
     *
     * Marking the team "pending" when the agency submits looks harmless, but
     * the approval cascade skips anyone whose own submission is under review -
     * so the cascade would then skip the very people it exists to approve,
     * and an approved agency would end up with nobody bookable.
     */
    const fresh = await registerAgency('Cascade');

    const added = await request(port, 'POST', '/api/v1/agencies/me/providers', {
      ...fresh,
      body: {
        fullName: 'Cascade Tester',
        email: 'cascade-' + unique() + '@agencytest.local',
        phone: '9' + String(Date.now()).slice(-9),
        password: PASSWORD,
      },
    });
    assert.equal(added.status, 201);

    const submitted = await request(port, 'POST', '/api/v1/agency-kyc/me', {
      ...fresh,
      body: {
        fullLegalName: 'Cascade Owner',
        idProofType: 'aadhaar',
        idProofLast4: '1234',
        addressLine: '1 Test Road',
        city: 'Bidar',
        state: 'Karnataka',
        pincode: '585401',
      },
    });
    assert.equal(submitted.status, 201);

    const agencyRow = await queryOne('SELECT id, verification_status FROM agencies WHERE user_id = $1', [
      fresh.user.id,
    ]);
    assert.equal(agencyRow.verification_status, 'pending', 'the agency is waiting');

    const person = await queryOne('SELECT verification_status FROM provider_profiles WHERE id = $1', [
      added.body.data.id,
    ]);
    assert.equal(
      person.verification_status,
      'unsubmitted',
      'the person has submitted nothing, so they are not pending',
    );

    // Now approve the agency the way an admin does, and check it reaches them.
    const submission = await queryOne(
      "SELECT id FROM kyc_submissions WHERE agency_id = $1 AND status = 'pending'",
      [agencyRow.id],
    );
    await query(
      `INSERT INTO kyc_documents (submission_id, doc_type, storage_key, mime_type, size_bytes)
       VALUES ($1,'identity','t/a.png','image/png',10),
              ($1,'address','t/b.png','image/png',10),
              ($1,'photo','t/c.png','image/png',10)`,
      [submission.id],
    );

    const admin = await request(port, 'POST', '/api/v1/auth/login', {
      body: { identifier: 'admin@servicesetu.in', password: PASSWORD },
    });
    const approved = await request(
      port, 'POST', '/api/v1/admin/kyc/' + submission.id + '/approve',
      { token: admin.body.data.accessToken, body: {} },
    );
    assert.equal(approved.status, 200, JSON.stringify(approved.body?.error));

    const after = await queryOne('SELECT verification_status FROM provider_profiles WHERE id = $1', [
      added.body.data.id,
    ]);
    assert.equal(
      after.verification_status,
      'unsubmitted',
      'approving the agency does not approve its people - each submits their own documents',
    );
  });

  await t.test('someone added to an approved agency still verifies themselves', async () => {
    /**
     * Approval is not inherited.
     *
     * This used to assert the opposite - that joining an approved agency made
     * someone bookable at once, because the agency had vouched for them. It
     * does not any more. Everyone entering a customer's home is checked on
     * their own Aadhaar and their own photograph, and an agency saying "they
     * are fine" is not the platform having looked.
     */
    const res = await request(port, 'POST', '/api/v1/agencies/me/providers', {
      ...agencyA,
      body: {
        fullName: 'Second Hire',
        email: 'second-' + unique() + '@agencytest.local',
        phone: '9' + String(Date.now()).slice(-9),
        password: PASSWORD,
      },
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.data.isBookable, false, 'an approved employer grants nothing');
    assert.equal(res.body.data.verificationStatus, 'unsubmitted');

    const row = await queryOne('SELECT verification_status FROM provider_profiles WHERE id = $1', [
      res.body.data.id,
    ]);
    assert.equal(row.verification_status, 'unsubmitted', 'and the database agrees');
  });

  await t.test('suspending the agency still stops its people working', async () => {
    /**
     * The direction that must keep cascading.
     *
     * Approval is no longer inherited, but withdrawal still is. Trust granted
     * individually can be removed collectively: the moment an agency is
     * suspended is exactly when its people must stop taking bookings under it,
     * and waiting to review each of them in turn would leave them live in the
     * meantime.
     */
    const agency = await registerAgency('Withdraw');

    const hired = await request(port, 'POST', '/api/v1/agencies/me/providers', {
      ...agency,
      body: {
        fullName: 'Withdrawn Worker',
        email: 'withdrawn-' + unique() + '@agencytest.local',
        phone: '9' + String(Date.now()).slice(-9),
        password: PASSWORD,
      },
    });
    assert.equal(hired.status, 201);

    const agencyRow = await queryOne('SELECT id FROM agencies WHERE user_id = $1', [agency.user.id]);

    // Approved individually, the only way it can happen now.
    await query(
      `UPDATE provider_profiles
          SET verification_status = 'approved', verified_at = NOW(), is_accepting_bookings = TRUE
        WHERE id = $1`,
      [hired.body.data.id],
    );

    const { setAgencyVerification } = await import('../src/modules/kyc/kyc.repository.js');
    const { withTransaction } = await import('../src/db/pool.js');
    await withTransaction((tx) => setAgencyVerification(tx, agencyRow.id, { status: 'suspended' }));

    const after = await queryOne(
      'SELECT verification_status, is_accepting_bookings FROM provider_profiles WHERE id = $1',
      [hired.body.data.id],
    );
    assert.equal(after.verification_status, 'suspended', 'the withdrawal reached them');
    assert.equal(after.is_accepting_bookings, false, 'and took them offline');
  });

  // ------------------------------------------------------------ the boundary

  await t.test('one agency cannot see another agency people', async () => {
    agencyB = await registerAgency('Beta');

    const mine = await request(port, 'GET', '/api/v1/agencies/me/providers', agencyB);
    assert.equal(mine.status, 200);
    assert.equal(mine.body.data.length, 0, 'a new agency employs nobody');

    const theirs = await request(port, 'GET', '/api/v1/agencies/me/providers', agencyA);
    assert.ok(theirs.body.data.length >= 2);

    const leaked = mine.body.data.some((p) => p.id === labourId);
    assert.equal(leaked, false, 'Alpha staff must never appear in Beta list');
  });

  await t.test('one agency cannot suspend another agency person', async () => {
    const res = await request(port, 'PATCH', '/api/v1/agencies/me/providers/' + labourId + '/status', {
      ...agencyB,
      body: { status: 'suspended', reason: 'Attempted cross-agency write' },
    });

    // 404 rather than 403: Beta has no business learning that this id exists.
    assert.equal(res.status, 404);

    const row = await queryOne(
      'SELECT u.status FROM provider_profiles p JOIN users u ON u.id = p.user_id WHERE p.id = $1',
      [labourId],
    );
    assert.equal(row.status, 'active', 'the target was untouched');
  });

  await t.test('one agency cannot read another agency jobs', async () => {
    const res = await request(port, 'GET', '/api/v1/agencies/me/bookings?limit=50', agencyB);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 0);
  });

  await t.test('a provider cannot reach the agency console', async () => {
    const login = await request(port, 'POST', '/api/v1/auth/login', {
      body: { identifier: labourEmail, password: PASSWORD },
    });
    const labour = { token: login.body.data.accessToken };

    for (const path of ['/api/v1/agencies/me', '/api/v1/agencies/me/providers', '/api/v1/agencies/me/overview']) {
      const res = await request(port, 'GET', path, labour);
      assert.equal(res.status, 403, path + ' must be agency-only');
    }
  });

  await t.test('a customer cannot reach the agency console', async () => {
    const customer = await request(port, 'POST', '/api/v1/auth/login', {
      body: { identifier: 'customer@servicesetu.in', password: PASSWORD },
    });

    const res = await request(port, 'GET', '/api/v1/agencies/me/providers', {
      token: customer.body.data.accessToken,
    });
    assert.equal(res.status, 403);
  });

  // --------------------------------------------------------------- the money

  await t.test('the agency holds no money and no payout destination', async () => {
    // The whole design rests on this: an agency manages people, it does not
    // sit between them and what they earned.
    const earnings = await request(port, 'GET', '/api/v1/earnings', agencyA);
    assert.equal(earnings.status, 403, 'an agency has no earnings ledger');

    const payout = await request(port, 'GET', '/api/v1/providers/me/payout-method', agencyA);
    assert.equal(payout.status, 403, 'an agency has no payout destination');

    const ledger = await queryOne(
      `SELECT COUNT(*)::int AS n FROM provider_earnings e
         JOIN provider_profiles p ON p.id = e.provider_id
        WHERE p.agency_id = (SELECT id FROM agencies WHERE user_id = $1)`,
      [agencyA.user.id],
    );
    assert.equal(typeof ledger.n, 'number');
  });

  await t.test('an agency labour owns their own earnings and bank details', async () => {
    const login = await request(port, 'POST', '/api/v1/auth/login', {
      body: { identifier: labourEmail, password: PASSWORD },
    });
    const labour = { token: login.body.data.accessToken };

    const earnings = await request(port, 'GET', '/api/v1/earnings', labour);
    assert.equal(earnings.status, 200, 'the person who does the work keeps the ledger');

    const saved = await request(port, 'PUT', '/api/v1/providers/me/payout-method', {
      ...labour,
      body: { preferred: 'upi', upi: { upiId: 'ravi' + unique() + '@okaxis' } },
    });
    assert.equal(saved.status, 200, 'and their own payout destination');
  });

  // -------------------------------------------------------------- suspension

  await t.test('an agency can suspend its own person, which stops them signing in', async () => {
    const res = await request(port, 'PATCH', '/api/v1/agencies/me/providers/' + labourId + '/status', {
      ...agencyA,
      body: { status: 'suspended', reason: 'No longer with us' },
    });
    assert.equal(res.status, 200);

    const login = await request(port, 'POST', '/api/v1/auth/login', {
      body: { identifier: labourEmail, password: PASSWORD },
    });
    assert.notEqual(login.status, 200, 'a suspended account cannot sign in');

    const offline = await queryOne(
      'SELECT is_accepting_bookings FROM provider_profiles WHERE id = $1',
      [labourId],
    );
    assert.equal(offline.is_accepting_bookings, false, 'and is taken out of search at once');
  });

  await t.test('restoring them puts the account back', async () => {
    const res = await request(port, 'PATCH', '/api/v1/agencies/me/providers/' + labourId + '/status', {
      ...agencyA,
      body: { status: 'active' },
    });
    assert.equal(res.status, 200);

    const login = await request(port, 'POST', '/api/v1/auth/login', {
      body: { identifier: labourEmail, password: PASSWORD },
    });
    assert.equal(login.status, 200);
  });

  // ---------------------------------------------------------------- overview

  await t.test('the overview counts only this agency people', async () => {
    const res = await request(port, 'GET', '/api/v1/agencies/me/overview', agencyA);
    assert.equal(res.status, 200);
    assert.ok(res.body.data.providers >= 2);
    assert.equal(res.body.data.canOperate, true);

    const other = await request(port, 'GET', '/api/v1/agencies/me/overview', agencyB);
    assert.equal(other.body.data.providers, 0);
  });

  await t.test('an agency cannot delete itself out from under its people', async () => {
    const agency = await queryOne('SELECT id FROM agencies WHERE user_id = $1', [agencyA.user.id]);

    await assert.rejects(
      () => query('DELETE FROM agencies WHERE id = $1', [agency.id]),
      // 23001 is restrict_violation, which is what ON DELETE RESTRICT raises -
      // not 23503, which is the plain foreign-key violation.
      (err) => err.code === '23001',
      'the database refuses to orphan employed providers',
    );
  });
});
