/**
 * Phase 11 tests: disputes, settings, payouts and analytics.
 *
 * The claims that matter: a dispute holds the provider's payout, resolving one
 * moves money through the same ledger everything else uses, a settings change
 * never rewrites bookings already priced, and a payout cannot pay the same
 * earnings twice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { pool, query, queryOne } from '../src/db/pool.js';
import { signWebhook } from '../src/services/payment/gateway.js';
import crypto from 'node:crypto';

const PASSWORD = 'Password@123';
const TAG = 'phase11-test';

/**
 * A request that keeps the raw bytes.
 *
 * The JSON helper above would decode and discard exactly what a CSV export
 * test needs to check - the byte order mark and the line endings.
 */
function raw(port, path, token) {
  return new Promise((resolve, reject) => {
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

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

function webhookRequest(port, { orderId, amountMinor }) {
  const { body, signature } = signWebhook({
    id: 'evt_' + crypto.randomBytes(8).toString('hex'),
    event: 'payment.captured',
    payload: { payment: { id: 'pay_' + crypto.randomBytes(8).toString('hex'), order_id: orderId, amount: amountMinor, method: 'upi' } },
  });
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, method: 'POST', path: '/api/v1/webhooks/payment',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-webhook-signature': signature,
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const signIn = async (port, identifier) =>
  (await request(port, 'POST', '/api/v1/auth/login', { body: { identifier, password: PASSWORD } })).body.data;

function weekdayAt(hour, daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}

async function cleanup() {
  const scope = "SELECT id FROM bookings WHERE description = $1";
  await query(`DELETE FROM dispute_messages WHERE dispute_id IN (SELECT id FROM disputes WHERE booking_id IN (${scope}))`, [TAG]);
  await query(`DELETE FROM disputes WHERE booking_id IN (${scope})`, [TAG]);
  await query(`DELETE FROM provider_earnings WHERE booking_id IN (${scope})`, [TAG]);
  await query(`DELETE FROM invoices WHERE booking_id IN (${scope})`, [TAG]);
  await query(`DELETE FROM refunds WHERE booking_id IN (${scope})`, [TAG]);
  await query(`DELETE FROM payment_events WHERE payment_id IN (SELECT id FROM payments WHERE booking_id IN (${scope}))`, [TAG]);
  await query(`DELETE FROM payments WHERE booking_id IN (${scope})`, [TAG]);
  await query('DELETE FROM bookings WHERE description = $1', [TAG]);
}

test('Phase 11: governance and analytics', async (t) => {
  await cleanup();
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const originalCommission = await queryOne("SELECT value FROM platform_settings WHERE key = 'commission'");

  t.after(async () => {
    await cleanup();
    // Settings are global, so this suite must put them back exactly.
    await query("UPDATE platform_settings SET value = $1 WHERE key = 'commission'",
      [JSON.stringify(originalCommission.value)]);
    server.close();
    await pool.end();
  });

  const customer = await signIn(port, 'customer@servicesetu.in');
  const providerLogin = await signIn(port, 'electrician@servicesetu.in');
  const admin = await signIn(port, 'admin@servicesetu.in');
  const cAuth = { token: customer.accessToken };
  const pAuth = { token: providerLogin.accessToken };
  const aAuth = { token: admin.accessToken };

  const provider = await queryOne(
    "SELECT p.id FROM provider_profiles p JOIN users u ON u.id = p.user_id WHERE u.email = 'electrician@servicesetu.in'",
  );
  const category = (await request(port, 'GET', '/api/v1/categories/switch-socket-repair')).body.data;

  let slotOffsetHours = 0;

  const makeBooking = (daysAhead, hour) =>
    request(port, 'POST', '/api/v1/bookings', {
      ...cAuth,
      body: {
        providerId: provider.id,
        categoryId: category.id,
        scheduledStart: weekdayAt(hour, daysAhead).toISOString(),
        address: { line: '12 MG Road', city: 'Bidar', state: 'Karnataka', pincode: '585401' },
        description: TAG,
      },
    });

  /** A booking driven to completed and paid. */
  async function paidBooking(daysAhead = 24, hour = 10) {
    const res = await makeBooking(daysAhead, hour);
    assert.equal(res.status, 201, JSON.stringify(res.body ? res.body.error : ''));
    const id = res.body.data.id;

    await request(port, 'POST', '/api/v1/bookings/' + id + '/accept', pAuth);
    slotOffsetHours += 2;
    await query(
      `UPDATE bookings SET scheduled_start = NOW() - ($2 || ' hours')::interval,
                           scheduled_end = NOW() - ($2 || ' hours')::interval + INTERVAL '30 minutes'
        WHERE id = $1`,
      [id, slotOffsetHours],
    );
    await request(port, 'POST', '/api/v1/bookings/' + id + '/start', pAuth);
    await request(port, 'POST', '/api/v1/bookings/' + id + '/complete', { ...cAuth, body: {} });

    const booking = (await request(port, 'GET', '/api/v1/bookings/' + id, cAuth)).body.data;

    const order = await request(port, 'POST', '/api/v1/payments/orders', {
      ...cAuth, body: { bookingId: id },
    });
    await webhookRequest(port, {
      orderId: order.body.data.payment.orderId,
      amountMinor: booking.pricing.finalMinor,
    });

    return booking;
  }

  let disputeId = null;
  let disputedBooking = null;

  await t.test('a dispute can only be raised on a completed booking', async () => {
    const res = await makeBooking(25, 15);

    const dispute = await request(port, 'POST', '/api/v1/disputes', {
      ...cAuth,
      body: {
        bookingId: res.body.data.id,
        category: 'work_quality',
        subject: 'Not happy with the work',
        description: 'The switchboard still sparks when I turn on the light.',
      },
    });
    assert.equal(dispute.status, 409);
    assert.match(dispute.body.error.message, /only a completed booking/i);
  });

  await t.test('raising a dispute moves the booking out of completed', async () => {
    disputedBooking = await paidBooking();

    const res = await request(port, 'POST', '/api/v1/disputes', {
      ...cAuth,
      body: {
        bookingId: disputedBooking.id,
        category: 'incomplete_work',
        subject: 'Job was left half finished',
        description: 'The electrician replaced one socket and left without doing the other two.',
        priority: 'high',
      },
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.data.status, 'open');
    assert.match(res.body.data.reference, /^DSP-/);
    disputeId = res.body.data.id;

    const booking = await request(port, 'GET', '/api/v1/bookings/' + disputedBooking.id, cAuth);
    assert.equal(booking.body.data.status, 'disputed', 'which is what holds the payout');
  });

  await t.test('a second dispute on the same booking is refused', async () => {
    const res = await request(port, 'POST', '/api/v1/disputes', {
      ...cAuth,
      body: {
        bookingId: disputedBooking.id,
        category: 'other',
        subject: 'Another complaint about the same job',
        description: 'Trying to raise a second dispute on a booking already under review.',
      },
    });
    assert.equal(res.status, 409);
  });

  await t.test('both parties can read and discuss the dispute', async () => {
    const asProvider = await request(port, 'GET', '/api/v1/disputes/' + disputeId, pAuth);
    assert.equal(asProvider.status, 200, 'the provider being complained about can see it');

    const reply = await request(port, 'POST', '/api/v1/disputes/' + disputeId + '/messages', {
      ...pAuth, body: { message: 'I was only asked to replace the one socket that was broken.' },
    });
    assert.equal(reply.status, 201);

    const thread = await request(port, 'GET', '/api/v1/disputes/' + disputeId, cAuth);
    assert.ok(thread.body.data.messages.length >= 1);
  });

  await t.test('an internal admin note is hidden from the parties', async () => {
    await request(port, 'POST', '/api/v1/disputes/' + disputeId + '/messages', {
      ...aAuth, body: { message: 'Checked the job photos, provider looks correct.', isInternal: true },
    });

    const adminView = await request(port, 'GET', '/api/v1/disputes/' + disputeId, aAuth);
    assert.ok(adminView.body.data.messages.some((m) => m.isInternal));

    const customerView = await request(port, 'GET', '/api/v1/disputes/' + disputeId, cAuth);
    assert.equal(
      customerView.body.data.messages.some((m) => m.isInternal),
      false,
      'internal notes stay internal',
    );
  });

  await t.test('a customer cannot mark their own message internal', async () => {
    await request(port, 'POST', '/api/v1/disputes/' + disputeId + '/messages', {
      ...cAuth, body: { message: 'Trying to post a hidden message.', isInternal: true },
    });

    const providerView = await request(port, 'GET', '/api/v1/disputes/' + disputeId, pAuth);
    assert.ok(
      providerView.body.data.messages.some((m) => /hidden message/.test(m.message)),
      'the flag was ignored for a non-admin',
    );
  });

  await t.test('the provider can find a dispute raised against them', async () => {
    // Not just read it by id - find it. Their payout is what is being held,
    // so a listing that only returns disputes they raised is useless to them.
    const mine = await request(port, 'GET', '/api/v1/disputes', pAuth);
    assert.equal(mine.status, 200);
    assert.ok(
      mine.body.data.some((d) => d.id === disputeId),
      'it appears in the provider list although the customer raised it',
    );

    const byBooking = await request(
      port, 'GET', '/api/v1/disputes?bookingId=' + disputedBooking.id, pAuth,
    );
    assert.equal(byBooking.body.data.length, 1, 'and is findable from the booking');
  });

  await t.test('an outsider cannot read the dispute', async () => {
    const outsider = await signIn(port, 'plumber@servicesetu.in');
    const res = await request(port, 'GET', '/api/v1/disputes/' + disputeId, { token: outsider.accessToken });
    assert.equal(res.status, 403);
  });

  await t.test('only an admin can resolve a dispute', async () => {
    const res = await request(port, 'POST', '/api/v1/admin/disputes/' + disputeId + '/resolve', {
      ...cAuth, body: { resolutionType: 'full_refund', resolution: 'Refunding myself here please.' },
    });
    assert.equal(res.status, 403);
  });

  await t.test('resolving with a partial refund moves money and closes the dispute', async () => {
    const refundAmount = Math.floor(disputedBooking.pricing.finalMinor / 2);

    const res = await request(port, 'POST', '/api/v1/admin/disputes/' + disputeId + '/resolve', {
      ...aAuth,
      body: {
        resolutionType: 'partial_refund',
        refundAmountMinor: refundAmount,
        resolution: 'Half the work was completed, so half the amount is refunded.',
      },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.refund.amountMinor, refundAmount);
    assert.equal(res.body.data.bookingStatus, 'completed', 'the work was partly done, so it stays completed');

    const reversal = await queryOne(
      "SELECT amount_minor FROM provider_earnings WHERE booking_id = $1 AND entry_type = 'refund_reversal'",
      [disputedBooking.id],
    );
    assert.ok(reversal, 'the refund went through the same ledger as any other');
    assert.ok(Number(reversal.amount_minor) < 0);

    const audit = await queryOne(
      "SELECT action FROM admin_audit_log WHERE entity_id = $1 AND action = 'dispute.resolved'",
      [disputeId],
    );
    assert.ok(audit, 'the decision is attributable to an admin');
  });

  await t.test('a resolved dispute cannot be resolved again', async () => {
    const res = await request(port, 'POST', '/api/v1/admin/disputes/' + disputeId + '/resolve', {
      ...aAuth, body: { resolutionType: 'no_refund', resolution: 'Changing my mind after the fact.' },
    });
    assert.equal(res.status, 409);
  });

  // ---------- platform settings ----------

  await t.test('only an admin can read or change platform settings', async () => {
    const asCustomer = await request(port, 'GET', '/api/v1/admin/settings', cAuth);
    assert.equal(asCustomer.status, 403);

    const asAdmin = await request(port, 'GET', '/api/v1/admin/settings', aAuth);
    assert.equal(asAdmin.status, 200);
    assert.ok(asAdmin.body.data.commission);
    assert.ok(asAdmin.body.data.cancellation);
  });

  await t.test('an out-of-range commission is rejected at the edge', async () => {
    const res = await request(port, 'PUT', '/api/v1/admin/settings/commission', {
      ...aAuth, body: { defaultPercent: 95 },
    });
    assert.equal(res.status, 422, 'a typo in a commission percentage is a money bug');
  });

  await t.test('an unknown setting key is rejected', async () => {
    const res = await request(port, 'PUT', '/api/v1/admin/settings/not_a_setting', {
      ...aAuth, body: { anything: true },
    });
    assert.equal(res.status, 422);
  });

  await t.test('a commission change applies to new bookings but never rewrites old ones', async () => {
    const before = await paidBooking(26, 11);
    const originalPercent = before.pricing.commissionPercent;

    const changed = await request(port, 'PUT', '/api/v1/admin/settings/commission', {
      ...aAuth, body: { defaultPercent: originalPercent + 5 },
    });
    assert.equal(changed.status, 200);

    const after = await paidBooking(27, 12);
    assert.equal(after.pricing.commissionPercent, originalPercent + 5, 'new bookings use the new rate');

    const unchanged = await request(port, 'GET', '/api/v1/bookings/' + before.id, cAuth);
    assert.equal(
      unchanged.body.data.pricing.commissionPercent,
      originalPercent,
      'the earlier booking kept the rate it was priced at',
    );

    const audit = await queryOne(
      "SELECT action FROM admin_audit_log WHERE action = 'settings.updated' ORDER BY created_at DESC LIMIT 1",
    );
    assert.ok(audit, 'the change is attributable');
  });

  // ---------- payouts ----------

  let payoutId = null;

  await t.test('a payout preview shows held money, but will not pay it', async () => {
    /**
     * Held earnings used to be absent from this screen entirely, which left an
     * admin looking at "nothing to pay" with no idea that money was owed or
     * when it would come due. They are listed now - and refused.
     *
     * Listing is not offering: `canPay` is what the button reads, and
     * `blockedBy` says which of the three reasons applies, because they need
     * different things from the admin.
     */
    const res = await request(port, 'GET', '/api/v1/admin/payouts/preview', aAuth);
    assert.equal(res.status, 200);
    assert.ok(res.body.data.policy.minimumAmountMinor >= 0);
    assert.ok(Array.isArray(res.body.data.providers));

    const listed = res.body.data.providers.find((p) => p.providerId === provider.id);
    assert.ok(listed, 'money owed is visible even while it is held');
    assert.equal(listed.canPay, false, 'but not payable');
    assert.equal(listed.blockedBy, 'dispute_window');
    // Not exactly zero: a refund reversal can push the available balance
    // negative, and the invariant that matters is that nothing is payable.
    assert.ok(listed.amountMinor <= 0, 'nothing is available yet');
    assert.ok(listed.heldMinor > 0, 'and the held figure says how much is coming');
    assert.ok(listed.availableFrom, 'with the moment it becomes payable, for the countdown');
    assert.ok(
      new Date(listed.availableFrom).getTime() > Date.now(),
      'which is in the future, or there would be nothing to count down to',
    );
  });

  await t.test('paying a provider with nothing payable is refused', async () => {
    // Hold everything back first. Stating the precondition beats assuming the
    // database starts empty - it does not when a previous run left rows behind.
    await query(
      `UPDATE provider_earnings SET available_at = NOW() + INTERVAL '1 day'
        WHERE provider_id = $1 AND payout_id IS NULL`,
      [provider.id],
    );

    const res = await request(port, 'POST', '/api/v1/admin/payouts/providers/' + provider.id, aAuth);
    assert.equal(res.status, 409);
    // Two distinct refusals are correct here: no rows are available at all, or
    // the available rows net to zero or less because a refund reversal is
    // sitting there waiting to be offset by future earnings. Neither should
    // send money.
    assert.match(res.body.error.message, /no earnings ready|no positive balance/i);
  });

  await t.test('a provider with no payout destination cannot be paid', async () => {
    await query(
      `UPDATE provider_earnings SET available_at = NOW() - INTERVAL '1 hour'
        WHERE booking_id IN (SELECT id FROM bookings WHERE description = $1)`,
      [TAG],
    );

    // Stated, not assumed: a provider row that survived an earlier run would
    // otherwise still carry the destination that run gave it, and this test
    // would silently pass money instead of refusing it.
    await query(
      `UPDATE provider_profiles
          SET payout_method = NULL, payout_upi_id = NULL, payout_account_name = NULL,
              payout_account_number = NULL, payout_ifsc = NULL, payout_bank_name = NULL
        WHERE id = $1`,
      [provider.id],
    );

    const claimedBefore = await queryOne(
      `SELECT COUNT(*)::int AS n FROM provider_earnings
        WHERE provider_id = $1 AND payout_id IS NOT NULL`,
      [provider.id],
    );

    const res = await request(port, 'POST', '/api/v1/admin/payouts/providers/' + provider.id, aAuth);
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /UPI id or bank account/i);

    // The refusal happens inside the transaction that took the row locks, so
    // the rollback leaves the money exactly as payable as it was.
    const claimedAfter = await queryOne(
      `SELECT COUNT(*)::int AS n FROM provider_earnings
        WHERE provider_id = $1 AND payout_id IS NOT NULL`,
      [provider.id],
    );
    assert.equal(claimedAfter.n, claimedBefore.n, 'a refused payout claims nothing');
  });

  await t.test('a provider supplies their own payout destination', async () => {
    const bad = await request(port, 'PUT', '/api/v1/providers/me/payout-method', {
      ...pAuth, body: { preferred: 'upi', upi: { upiId: 'not-a-upi-id' } },
    });
    assert.equal(bad.status, 422, 'a malformed UPI id is refused');

    const res = await request(port, 'PUT', '/api/v1/providers/me/payout-method', {
      ...pAuth,
      body: {
        preferred: 'bank',
        bank: { accountName: 'Raj Electricals', accountNumber: '918273645500', ifsc: 'hdfc0001234' },
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.method, 'bank');
    assert.equal(res.body.data.ifsc, 'HDFC0001234', 'IFSC is normalised to upper case');
  });

  await t.test('both destinations can be held at once', async () => {
    const res = await request(port, 'PUT', '/api/v1/providers/me/payout-method', {
      ...pAuth,
      body: {
        preferred: 'bank',
        upi: { upiId: 'raj@okaxis' },
        bank: { accountName: 'Raj Electricals', accountNumber: '918273645500', ifsc: 'HDFC0001234' },
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body?.error ?? ''));
    assert.equal(res.body.data.upiId, 'raj@okaxis');
    assert.equal(res.body.data.accountNumber, '918273645500');
    assert.equal(res.body.data.method, 'bank', 'and one of them is the preferred destination');
  });

  await t.test('preferring a destination that was not supplied is refused', async () => {
    const res = await request(port, 'PUT', '/api/v1/providers/me/payout-method', {
      ...pAuth, body: { preferred: 'upi', bank: { accountName: 'Raj Electricals', accountNumber: '918273645500', ifsc: 'HDFC0001234' } },
    });
    assert.equal(res.status, 422, 'the payout queue would otherwise point at nothing');
  });

  await t.test('omitting a destination removes it, rather than leaving it behind', async () => {
    const res = await request(port, 'PUT', '/api/v1/providers/me/payout-method', {
      ...pAuth, body: { preferred: 'upi', upi: { upiId: 'raj@okaxis' } },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.upiId, 'raj@okaxis');
    assert.equal(
      res.body.data.accountNumber,
      null,
      'a bank account left out of the payload is cleared - this is how a provider deletes one',
    );

    // Back to bank for the payout below, so the admin queue has full details.
    await request(port, 'PUT', '/api/v1/providers/me/payout-method', {
      ...pAuth,
      body: {
        preferred: 'bank',
        bank: { accountName: 'Raj Electricals', accountNumber: '918273645500', ifsc: 'HDFC0001234' },
      },
    });
  });

  await t.test('the payout queue shows the admin where to send the money', async () => {
    const res = await request(port, 'GET', '/api/v1/admin/payouts/preview', aAuth);
    const listed = res.body.data.providers.find((p) => p.providerId === provider.id);

    assert.ok(listed, 'released earnings now appear');
    assert.equal(listed.canPay, true);
    assert.equal(listed.destination.method, 'bank');
    assert.equal(listed.destination.accountNumber, '918273645500', 'the admin paying it sees the full number');
    assert.equal(listed.destination.ifsc, 'HDFC0001234');
  });

  await t.test('once the window closes the money is claimed exactly once', async () => {

    const expected = await queryOne(
      `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS total FROM provider_earnings
        WHERE provider_id = $1 AND payout_id IS NULL
          AND (available_at IS NULL OR available_at <= NOW())`,
      [provider.id],
    );

    const claimed = await request(port, 'POST', '/api/v1/admin/payouts/providers/' + provider.id, aAuth);
    assert.equal(claimed.status, 200);
    // Manual mode: the money is owed and claimed, not sent. Reporting this as
    // 'paid' would show money out of the door that is still in the account.
    assert.equal(claimed.body.data.status, 'pending');
    assert.equal(claimed.body.data.method, 'manual');
    assert.equal(claimed.body.data.amountMinor, Number(expected.total), 'claimed exactly the available balance');
    assert.match(claimed.body.data.reference, /^PO-/);
    payoutId = claimed.body.data.id;

    // The claimed rows are stamped, so a second run finds nothing.
    const again = await request(port, 'POST', '/api/v1/admin/payouts/providers/' + provider.id, aAuth);
    assert.equal(again.status, 409, 'the same earnings cannot be claimed twice');
  });

  await t.test('nothing is left available once the balance is paid out', async () => {
    const balance = await request(port, 'GET', '/api/v1/earnings', pAuth);
    assert.equal(balance.body.data.balance.availableMinor, 0);
  });

  await t.test('marking a transfer paid requires the bank reference', async () => {
    const res = await request(port, 'POST', '/api/v1/admin/payouts/' + payoutId + '/mark-paid', {
      ...aAuth, body: {},
    });
    assert.equal(res.status, 422, 'a payout cannot be declared paid with no evidence');
  });

  await t.test('an admin records the transfer they made by hand', async () => {
    const res = await request(port, 'POST', '/api/v1/admin/payouts/' + payoutId + '/mark-paid', {
      ...aAuth, body: { paymentReference: 'UTR123456789' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'paid');
    assert.equal(res.body.data.paymentReference, 'UTR123456789');

    const again = await request(port, 'POST', '/api/v1/admin/payouts/' + payoutId + '/mark-paid', {
      ...aAuth, body: { paymentReference: 'UTR999999999' },
    });
    assert.equal(again.status, 409, 'the same payout cannot be paid twice');

    const audit = await queryOne(
      "SELECT action FROM admin_audit_log WHERE action = 'payout.marked_paid' ORDER BY created_at DESC LIMIT 1",
    );
    assert.ok(audit, 'who marked it is on the record');
  });

  await t.test('a failed transfer gives the money back to the provider', async () => {
    // A fresh earning, released and claimed, so there is something to fail.
    await query(
      `INSERT INTO provider_earnings (provider_id, entry_type, amount_minor, description, available_at)
       VALUES ($1, 'job_earning', 25000, $2, NOW() - INTERVAL '1 hour')`,
      [provider.id, TAG + '-failtest'],
    );

    const claimed = await request(port, 'POST', '/api/v1/admin/payouts/providers/' + provider.id, aAuth);
    assert.equal(claimed.status, 200);

    const before = await request(port, 'GET', '/api/v1/earnings', pAuth);
    assert.equal(before.body.data.balance.availableMinor, 0, 'claimed money is not available');

    const failed = await request(port, 'POST', '/api/v1/admin/payouts/' + claimed.body.data.id + '/mark-failed', {
      ...aAuth, body: { reason: 'The account number was rejected by the bank.' },
    });
    assert.equal(failed.status, 200);
    assert.equal(failed.body.data.releasedToBalance, true);

    // The whole point: a transfer that did not happen must not leave the
    // provider silently unpaid forever.
    const after = await request(port, 'GET', '/api/v1/earnings', pAuth);
    assert.equal(after.body.data.balance.availableMinor, 25000, 'the money is payable again');

    const debit = await queryOne(
      `SELECT COUNT(*)::int AS n FROM provider_earnings
        WHERE payout_id = $1 AND entry_type = 'payout'`,
      [claimed.body.data.id],
    );
    assert.equal(debit.n, 0, 'the balancing debit is removed with it');
  });

  await t.test('payouts are listed with their provider, status and destination', async () => {
    const res = await request(port, 'GET', '/api/v1/admin/payouts', aAuth);
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length >= 1);
    assert.ok(res.body.data[0].providerName);

    const settled = res.body.data.find((p) => p.id === payoutId);
    assert.equal(settled.status, 'paid');
    assert.equal(settled.method, 'manual');
    assert.equal(settled.paymentReference, 'UTR123456789');
    // History is read at a glance and over shoulders; it does not need the
    // full account number to be useful.
    assert.equal(settled.destination.accountNumber, '********5500');

    // A payout still waiting to be sent is the opposite case: the admin has to
    // retype these into a banking app, so they get the real number.
    const queued = await request(port, 'POST', '/api/v1/admin/payouts/providers/' + provider.id, aAuth);
    if (queued.status === 200) {
      const awaiting = await request(port, 'GET', '/api/v1/admin/payouts?status=pending', aAuth);
      const row = awaiting.body.data.find((p) => p.id === queued.body.data.id);
      assert.equal(row.destination.accountNumber, '918273645500', 'payable rows show the full number');
    }
  });

  // ---------- reports ----------

  /**
   * Payments deliberately RESTRICT the deletion of their booking - a payment
   * record must outlive the thing it paid for - so they are cleared first.
   */
  const clearRevtest = async () => {
    await query(
      "DELETE FROM payments WHERE booking_id IN (SELECT id FROM bookings WHERE address_city = 'Revtest')",
    );
    await query("DELETE FROM bookings WHERE address_city = 'Revtest'");
  };


  await t.test('the services report returns rows with totals over the whole set', async () => {
    const res = await request(port, 'GET', '/api/v1/admin/reports/services?limit=2', aAuth);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data.rows));
    assert.ok(res.body.data.rows.length <= 2, 'the page is honoured');

    // The headline claim: totals cover every matching booking, not the page.
    assert.ok(
      res.body.data.totals.bookings >= res.body.data.rows.length,
      'totals are computed over the filtered set, not the page on screen',
    );

    const row = res.body.data.rows[0];
    assert.ok(row.reference.startsWith('BK-'));
    assert.ok(row.service && row.provider && row.customer, 'the row names everyone involved');
    assert.equal(typeof row.commissionMinor, 'number');
  });

  await t.test('a booking with several payment attempts is still one row', async () => {
    // Two rows for one booking would double every amount in the export.
    const dup = await queryOne(
      `SELECT b.reference, COUNT(*)::int AS attempts
         FROM bookings b JOIN payments p ON p.booking_id = b.id
        GROUP BY b.reference HAVING COUNT(*) > 1 LIMIT 1`,
    );

    if (dup) {
      const res = await request(port, 'GET', '/api/v1/admin/reports/services?limit=5000', aAuth);
      const matches = res.body.data.rows.filter((r) => r.reference === dup.reference);
      assert.equal(matches.length, 1, dup.reference + ' has ' + dup.attempts + ' payments but must appear once');
    }
  });

  await t.test('filtering the services report narrows rows and totals together', async () => {
    const res = await request(port, 'GET', '/api/v1/admin/reports/services?status=completed', aAuth);
    assert.equal(res.status, 200);
    assert.ok(res.body.data.rows.every((r) => r.status === 'completed'));
    assert.equal(res.body.data.totals.bookings, res.body.data.totals.completed);
    assert.equal(res.body.data.totals.cancelled, 0, 'the totals follow the filter');
  });

  await t.test('a completed job is not revenue until the customer has paid', async () => {
    // The defect this guards: admin figures counted completion, while the
    // provider ledger counted payment, so the two screens disagreed and the
    // platform booked income nobody had paid.
    // A run that fails mid-way would otherwise leave its booking behind and
    // break every later run on the unique reference.
    await clearRevtest();

    const provider = await queryOne('SELECT id FROM provider_profiles LIMIT 1');
    const customer = await queryOne("SELECT id FROM users WHERE role = 'customer' LIMIT 1");
    const category = await queryOne('SELECT id FROM service_categories LIMIT 1');
    const tag = 'REVCHK' + Date.now().toString(36).toUpperCase().slice(-5);

    const booking = await queryOne(
      `INSERT INTO bookings (reference, customer_id, provider_id, category_id, status,
         scheduled_start, scheduled_end, address_line, address_city, address_state, address_pincode,
         quoted_amount_minor, final_amount_minor, commission_percent, commission_amount_minor,
         provider_earning_minor, completed_at)
       VALUES ('BK-' || $4, $1, $2, $3, 'completed', NOW(), NOW() + INTERVAL '1 hour',
         'A', 'Revtest', 'Karnataka', '585401', 100000, 100000, 15, 15000, 85000, NOW())
       RETURNING id`,
      [customer.id, provider.id, category.id, tag],
    );

    const unpaid = await request(port, 'GET', '/api/v1/admin/reports/services?city=Revtest', aAuth);
    assert.equal(unpaid.body.data.totals.collected, 0, 'unpaid work is not collected revenue');
    assert.equal(unpaid.body.data.totals.commission, 0, 'and it earns no commission yet');
    assert.equal(unpaid.body.data.totals.billed, 1000, 'but it is still reported as billed');
    assert.equal(unpaid.body.data.totals.awaitingPayment, 1000, 'and shown as awaiting payment');

    // Now settle it. Only the payment should move the numbers.
    await query(
      `INSERT INTO payments (reference, booking_id, customer_id, status, amount_minor, gateway, paid_at)
       VALUES ('PAY-' || $3, $1, $2, 'paid', 100000, 'mock', NOW())`,
      [booking.id, customer.id, tag],
    );

    const paid = await request(port, 'GET', '/api/v1/admin/reports/services?city=Revtest', aAuth);
    assert.equal(paid.body.data.totals.collected, 1000, 'a settled payment is revenue');
    assert.equal(paid.body.data.totals.commission, 150, 'and the commission follows it');
    assert.equal(paid.body.data.totals.awaitingPayment, 0, 'nothing is outstanding any more');

    await clearRevtest();
  });

  await t.test('the dashboard reports the same revenue basis as the report', async () => {
    const [dash, report] = await Promise.all([
      request(port, 'GET', '/api/v1/admin/analytics/dashboard', aAuth),
      request(port, 'GET', '/api/v1/admin/reports/services', aAuth),
    ]);

    // Two screens reading the same money must not disagree; that disagreement
    // is what made this bug invisible for as long as it was.
    assert.equal(
      dash.body.data.revenue.gross.minor,
      report.body.data.totals.collectedMinor,
      'dashboard revenue equals the report collected total',
    );
    assert.equal(
      dash.body.data.revenue.commission.minor,
      report.body.data.totals.commissionMinor,
      'and so does the commission',
    );
  });

  await t.test('an unknown status is refused rather than ignored', async () => {
    const res = await request(port, 'GET', '/api/v1/admin/reports/services?status=nonsense', aAuth);
    assert.equal(res.status, 422, 'a typo must not silently return the unfiltered report');
  });

  await t.test('the payouts report separates what is paid from what is owed', async () => {
    const res = await request(port, 'GET', '/api/v1/admin/reports/payouts?limit=5', aAuth);
    assert.equal(res.status, 200);

    const { totals, outstanding } = res.body.data;
    assert.equal(typeof totals.paidCount, 'number');
    assert.equal(typeof totals.awaitingCount, 'number');
    assert.ok(Array.isArray(outstanding), 'money owed but not yet in any payout is reported too');

    const row = res.body.data.rows[0];
    if (row) {
      assert.ok(row.reference.startsWith('PO-'));
      // A report is read, filed and forwarded; none of that needs the full
      // number. The IFSC stays intact - it identifies a branch, not an account.
      if ((row.destination || '').includes('/')) {
        assert.match(row.destination, /^\*+\d{4} \//, 'only the last four digits of the account survive');
      }
    }
  });

  await t.test('a report exports as CSV with the filters applied', async () => {
    const res = await raw(port, '/api/v1/admin/reports/payouts?format=csv&limit=10', aAuth.token);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/csv/);
    assert.match(res.headers['content-disposition'], /attachment; filename="servicesetu-payouts-\d{4}-\d{2}-\d{2}\.csv"/);

    const body = res.body.toString('utf8');
    // Excel reads a plain UTF-8 CSV as the local codepage and mangles the
    // rupee sign, so the BOM is load-bearing rather than decorative.
    assert.equal(body.charCodeAt(0), 0xfeff, 'the export carries a UTF-8 BOM for Excel');
    assert.match(body, /Payout,Provider,Status,Method,Amount/);
  });

  await t.test('the payout history exports as CSV', async () => {
    const res = await raw(port, '/api/v1/admin/payouts?format=csv', aAuth.token);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/csv/);
    assert.match(
      res.headers['content-disposition'],
      /attachment; filename="servicemitra-payouts-\d{4}-\d{2}-\d{2}\.csv"/,
    );

    const body = res.body.toString('utf8');
    assert.equal(body.charCodeAt(0), 0xfeff, 'the export carries a UTF-8 BOM for Excel');
    assert.match(body, /Reference,Provider,Status,Amount,Method,Bank reference/);
    assert.match(
      body,
      /Bank reference/,
      'the bank reference is the only evidence tying a row to money that moved',
    );
  });

  await t.test('a name that looks like a formula cannot execute in a spreadsheet', async () => {
    const { toCsv } = await import('../src/modules/admin/reports.service.js');
    const csv = toCsv([{ header: 'Provider', value: (r) => r.name }], [{ name: '=1+1' }]);

    assert.match(csv, /'=1\+1/, 'a leading = is quoted so Excel treats it as text');
  });

  // ---------- analytics ----------

  await t.test('the dashboard returns every panel the admin console needs', async () => {
    const res = await request(port, 'GET', '/api/v1/admin/analytics/dashboard', aAuth);
    assert.equal(res.status, 200);

    const d = res.body.data;
    assert.ok(d.bookings.total >= 1);
    assert.equal(typeof d.bookings.completionRate, 'number');
    assert.equal(typeof d.revenue.gross.minor, 'number');
    assert.equal(typeof d.revenue.gross.value, 'number', 'amounts come in rupees too');
    assert.ok(d.marketplace.verifiedProviders >= 1);
    assert.equal(typeof d.attention.pendingKyc, 'number');
    assert.equal(typeof d.funnel.acceptanceRate, 'number');
    assert.equal(typeof d.retention.repeatRate, 'number');
    assert.equal(typeof d.payments.successRate, 'number');
  });

  await t.test('net revenue accounts for refunds', async () => {
    const res = await request(port, 'GET', '/api/v1/admin/analytics/dashboard', aAuth);
    const r = res.body.data.revenue;
    assert.equal(r.net.minor, r.gross.minor - r.refunded.minor, 'net is gross minus refunds');
    assert.ok(r.refunded.minor > 0, 'this suite issued a dispute refund');
  });

  await t.test('the time series fills empty periods with zeroes', async () => {
    const res = await request(port, 'GET', '/api/v1/admin/analytics/series?granularity=day', aAuth);
    assert.equal(res.status, 200);
    assert.ok(res.body.data.points.length >= 28, 'a point per day, not only days with data');
    assert.ok(res.body.data.points.every((p) => typeof p.bookings === 'number'));
  });

  await t.test('top categories and locations are ranked', async () => {
    const categories = await request(port, 'GET', '/api/v1/admin/analytics/categories?limit=5', aAuth);
    assert.equal(categories.status, 200);
    const counts = categories.body.data.map((c) => c.bookings);
    assert.deepEqual(counts, [...counts].sort((a, b) => b - a), 'ordered by volume');

    const locations = await request(port, 'GET', '/api/v1/admin/analytics/locations', aAuth);
    assert.ok(locations.body.data.some((l) => l.city === 'Bidar'));
  });

  await t.test('the provider leaderboard can be sorted', async () => {
    const byRevenue = await request(port, 'GET', '/api/v1/admin/analytics/providers?sort=revenue', aAuth);
    assert.equal(byRevenue.status, 200);
    const revenues = byRevenue.body.data.map((p) => p.revenue.minor);
    assert.deepEqual(revenues, [...revenues].sort((a, b) => b - a));

    const byRating = await request(port, 'GET', '/api/v1/admin/analytics/providers?sort=rating', aAuth);
    const ratings = byRating.body.data.map((p) => p.rating.average);
    assert.deepEqual(ratings, [...ratings].sort((a, b) => b - a));
  });

  await t.test('a provider cannot read platform-wide analytics', async () => {
    const res = await request(port, 'GET', '/api/v1/admin/analytics/dashboard', pAuth);
    assert.equal(res.status, 403);
  });
});
