/**
 * Phase 9 tests: payments, invoicing and the earnings ledger.
 *
 * The four claims under test are the ones that would cost real money if they
 * were wrong: the client cannot set an amount, an unsigned webhook cannot mark
 * anything paid, a retried webhook cannot credit twice, and a refund cannot
 * exceed what was collected.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { pool, query, queryOne } from '../src/db/pool.js';
import { signWebhook } from '../src/services/payment/gateway.js';
import { settleFromGateway } from '../src/modules/payments/payment.service.js';
import env from '../src/config/env.js';

const PASSWORD = 'Password@123';
const TAG = 'phase9-test';

function request(port, method, path, { body, token, headers: extra = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
    const headers = { 'Content-Type': 'application/json', ...extra };
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

/** Builds a correctly signed gateway webhook, the way the provider would. */
function webhookFor({ orderId, amountMinor, type = 'payment.captured', eventId, paymentId }) {
  const { body, signature } = signWebhook({
    id: eventId ?? 'evt_' + crypto.randomBytes(8).toString('hex'),
    event: type,
    payload: {
      payment: {
        id: paymentId ?? 'pay_' + crypto.randomBytes(8).toString('hex'),
        order_id: orderId,
        amount: amountMinor,
        method: 'upi',
      },
    },
  });
  return { body, signature };
}

function weekdayAt(hour, daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/**
 * Financial rows reference bookings with ON DELETE RESTRICT - deliberately, so
 * accounting history cannot be orphaned by removing a booking. Test cleanup
 * therefore has to unwind in dependency order rather than relying on a cascade.
 */
async function cleanup() {
  const scope = "SELECT id FROM bookings WHERE description = $1";
  await query(`DELETE FROM provider_earnings WHERE booking_id IN (${scope})`, [TAG]);
  await query(`DELETE FROM invoices WHERE booking_id IN (${scope})`, [TAG]);
  await query(`DELETE FROM refunds WHERE booking_id IN (${scope})`, [TAG]);
  await query(
    `DELETE FROM payment_events WHERE payment_id IN (
       SELECT id FROM payments WHERE booking_id IN (${scope}))`,
    [TAG],
  );
  await query(`DELETE FROM payments WHERE booking_id IN (${scope})`, [TAG]);
  await query('DELETE FROM bookings WHERE description = $1', [TAG]);
}

test('Phase 9: payments and invoicing', async (t) => {
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
  const admin = await signIn(port, 'admin@servicesetu.in');
  const cAuth = { token: customer.accessToken };
  const pAuth = { token: providerLogin.accessToken };
  const aAuth = { token: admin.accessToken };

  const provider = await queryOne(
    "SELECT p.id FROM provider_profiles p JOIN users u ON u.id = p.user_id WHERE u.email = 'plumber@servicesetu.in'",
  );
  const category = (await request(port, 'GET', '/api/v1/categories/tap-mixer-repair')).body.data;

  let slotOffsetHours = 0;

  /** Creates a booking and drives it all the way to completed. */
  async function completedBooking() {
    const res = await request(port, 'POST', '/api/v1/bookings', {
      ...cAuth,
      body: {
        providerId: provider.id,
        categoryId: category.id,
        scheduledStart: weekdayAt(10, 20).toISOString(),
        address: { line: '12 MG Road', city: 'Bidar', state: 'Karnataka', pincode: '585401' },
        description: TAG,
      },
    });
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

    const booking = await request(port, 'GET', '/api/v1/bookings/' + id, cAuth);
    return booking.body.data;
  }

  await t.test('the payment order amount comes from the booking, not the request', async () => {
    const booking = await completedBooking();

    const res = await request(port, 'POST', '/api/v1/payments/orders', {
      ...cAuth,
      body: { bookingId: booking.id, amountMinor: 1, amount: 1 },
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.data.payment.amountMinor, booking.pricing.finalMinor);
    assert.notEqual(res.body.data.payment.amountMinor, 1, 'the injected amount was ignored');
    assert.equal(res.body.data.payment.status, 'pending');
    assert.ok(res.body.data.checkout.key, 'checkout config returned for the widget');
  });

  await t.test('an unsigned webhook cannot mark anything paid', async () => {
    const booking = await completedBooking();
    const order = await request(port, 'POST', '/api/v1/payments/orders', {
      ...cAuth, body: { bookingId: booking.id },
    });
    const orderId = order.body.data.payment.orderId;

    const { body } = webhookFor({ orderId, amountMinor: booking.pricing.finalMinor });

    const noSig = await request(port, 'POST', '/api/v1/webhooks/payment', { body });
    assert.equal(noSig.status, 403);

    const forged = await request(port, 'POST', '/api/v1/webhooks/payment', {
      body, headers: { 'x-webhook-signature': 'f'.repeat(64) },
    });
    assert.equal(forged.status, 403);

    const status = await request(port, 'GET', '/api/v1/payments/bookings/' + booking.id, cAuth);
    assert.equal(status.body.data.isPaid, false, 'the payment is still unpaid');
  });

  await t.test('an invalid-signature delivery is still recorded as evidence', async () => {
    const rows = await query(
      "SELECT COUNT(*)::int AS c FROM payment_events WHERE signature_valid = FALSE",
    );
    // One row, not two: both forged attempts carried the same event id, so the
    // second conflicted on the idempotency index - and was still refused 403.
    assert.ok(rows.rows[0].c >= 1, 'rejected deliveries are kept, not discarded');
  });

  await t.test('a signed webhook marks it paid, issues the invoice and writes the ledger', async () => {
    const booking = await completedBooking();
    const order = await request(port, 'POST', '/api/v1/payments/orders', {
      ...cAuth, body: { bookingId: booking.id },
    });
    const orderId = order.body.data.payment.orderId;

    const { body, signature } = webhookFor({ orderId, amountMinor: booking.pricing.finalMinor });

    const res = await request(port, 'POST', '/api/v1/webhooks/payment', {
      body, headers: { 'x-webhook-signature': signature },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'paid');
    assert.equal(res.body.data.duplicate, false);

    const status = await request(port, 'GET', '/api/v1/payments/bookings/' + booking.id, cAuth);
    assert.equal(status.body.data.isPaid, true);
    assert.ok(status.body.data.invoiceId, 'an invoice was generated');

    const invoice = await request(port, 'GET', '/api/v1/invoices/' + status.body.data.invoiceId, cAuth);
    assert.equal(invoice.status, 200);
    assert.match(invoice.body.data.invoiceNumber, /^INV-\d{4}-\d{5}$/);
    assert.equal(invoice.body.data.totals.totalMinor, booking.pricing.finalMinor);
    assert.ok(invoice.body.data.lineItems.length >= 1);

    const ledger = await query(
      "SELECT entry_type, amount_minor FROM provider_earnings WHERE booking_id = $1 ORDER BY entry_type",
      [booking.id],
    );
    const entries = Object.fromEntries(ledger.rows.map((r) => [r.entry_type, Number(r.amount_minor)]));
    assert.equal(entries.job_earning, booking.pricing.finalMinor, 'gross earning credited');
    assert.equal(entries.commission, -booking.pricing.commissionMinor, 'commission debited separately');
    assert.equal(
      entries.job_earning + entries.commission,
      booking.pricing.providerEarningMinor,
      'the two rows net to the provider earning on the booking',
    );
  });

  /**
   * The provider's job screen reads this to tell "you have earned X" apart
   * from "X has arrived". The booking itself carries no payment status - its
   * pricing block is a calculation and reads the same either way - so without
   * this endpoint the person who did the work cannot tell whether they have
   * been paid.
   */
  await t.test('the provider on the job can see whether the customer paid', async () => {
    const booking = await completedBooking();

    const before = await request(port, 'GET', '/api/v1/payments/bookings/' + booking.id, pAuth);
    assert.equal(before.status, 200, 'the provider on the booking may read it');
    assert.equal(before.body.data.isPaid, false);

    const order = await request(port, 'POST', '/api/v1/payments/orders', {
      ...cAuth, body: { bookingId: booking.id },
    });
    const { body, signature } = webhookFor({
      orderId: order.body.data.payment.orderId,
      amountMinor: booking.pricing.finalMinor,
    });
    await request(port, 'POST', '/api/v1/webhooks/payment', {
      body, headers: { 'x-webhook-signature': signature },
    });

    const after = await request(port, 'GET', '/api/v1/payments/bookings/' + booking.id, pAuth);
    assert.equal(after.body.data.isPaid, true, 'the provider sees the payment land');
    assert.ok(
      after.body.data.payments.some((p) => p.status === 'paid' && p.paidAt),
      'and when it landed, which is what the screen shows',
    );
  });

  await t.test('a provider who is not on the job is refused', async () => {
    const booking = await completedBooking();
    const other = await signIn(port, 'electrician@servicesetu.in');

    const res = await request(port, 'GET', '/api/v1/payments/bookings/' + booking.id, {
      token: other.accessToken,
    });
    assert.equal(res.status, 403, 'payment detail is not readable across jobs');
  });

  await t.test('a retried webhook cannot credit the same payment twice', async () => {
    const booking = await completedBooking();
    const order = await request(port, 'POST', '/api/v1/payments/orders', {
      ...cAuth, body: { bookingId: booking.id },
    });
    const orderId = order.body.data.payment.orderId;

    // The same event id the gateway would resend on a delivery retry.
    const eventId = 'evt_retry_' + crypto.randomBytes(6).toString('hex');
    const hook = webhookFor({ orderId, amountMinor: booking.pricing.finalMinor, eventId });

    const one = await request(port, 'POST', '/api/v1/webhooks/payment', {
      body: hook.body, headers: { 'x-webhook-signature': hook.signature },
    });
    assert.equal(one.body.data.duplicate, false);

    const two = await request(port, 'POST', '/api/v1/webhooks/payment', {
      body: hook.body, headers: { 'x-webhook-signature': hook.signature },
    });
    assert.equal(two.status, 200, 'a duplicate returns 200 so the gateway stops retrying');
    assert.equal(two.body.data.duplicate, true);

    const ledger = await query(
      "SELECT COUNT(*)::int AS c FROM provider_earnings WHERE booking_id = $1 AND entry_type = 'job_earning'",
      [booking.id],
    );
    assert.equal(ledger.rows[0].c, 1, 'the earning was credited exactly once');

    const invoices = await query('SELECT COUNT(*)::int AS c FROM invoices WHERE booking_id = $1', [booking.id]);
    assert.equal(invoices.rows[0].c, 1, 'exactly one invoice exists');
  });

  await t.test('a webhook whose amount disagrees with the order is refused', async () => {
    const booking = await completedBooking();
    const order = await request(port, 'POST', '/api/v1/payments/orders', {
      ...cAuth, body: { bookingId: booking.id },
    });

    const tampered = webhookFor({ orderId: order.body.data.payment.orderId, amountMinor: 100 });

    const res = await request(port, 'POST', '/api/v1/webhooks/payment', {
      body: tampered.body, headers: { 'x-webhook-signature': tampered.signature },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /does not match/i);

    const status = await request(port, 'GET', '/api/v1/payments/bookings/' + booking.id, cAuth);
    assert.equal(status.body.data.isPaid, false);
  });

  await t.test('a failed payment is recorded without blocking a retry', async () => {
    const booking = await completedBooking();
    const order = await request(port, 'POST', '/api/v1/payments/orders', {
      ...cAuth, body: { bookingId: booking.id },
    });
    const orderId = order.body.data.payment.orderId;

    const failed = webhookFor({
      orderId, amountMinor: booking.pricing.finalMinor, type: 'payment.failed',
    });
    const res = await request(port, 'POST', '/api/v1/webhooks/payment', {
      body: failed.body, headers: { 'x-webhook-signature': failed.signature },
    });
    assert.equal(res.body.data.status, 'failed');

    const retry = await request(port, 'POST', '/api/v1/payments/orders', {
      ...cAuth, body: { bookingId: booking.id },
    });
    assert.equal(retry.status, 201);
    assert.notEqual(retry.body.data.payment.orderId, orderId, 'a new order was created');
  });

  // ---------- refunds ----------

  /** A booking driven all the way through to paid. */
  async function paidBooking() {
    const booking = await completedBooking();
    const order = await request(port, 'POST', '/api/v1/payments/orders', {
      ...cAuth, body: { bookingId: booking.id },
    });
    const hook = webhookFor({
      orderId: order.body.data.payment.orderId,
      amountMinor: booking.pricing.finalMinor,
    });
    await request(port, 'POST', '/api/v1/webhooks/payment', {
      body: hook.body, headers: { 'x-webhook-signature': hook.signature },
    });
    return booking;
  }

  await t.test('only an admin may issue a refund', async () => {
    const booking = await paidBooking();

    const asCustomer = await request(port, 'POST', '/api/v1/payments/bookings/' + booking.id + '/refund', {
      ...cAuth, body: { reason: 'I would like my money back please' },
    });
    assert.equal(asCustomer.status, 403);

    const asProvider = await request(port, 'POST', '/api/v1/payments/bookings/' + booking.id + '/refund', {
      ...pAuth, body: { reason: 'Refunding the customer myself' },
    });
    assert.equal(asProvider.status, 403);
  });

  await t.test('a refund cannot exceed what was collected', async () => {
    const booking = await paidBooking();

    const res = await request(port, 'POST', '/api/v1/payments/bookings/' + booking.id + '/refund', {
      ...aAuth,
      body: { amountMinor: booking.pricing.finalMinor * 10, reason: 'Attempting to over-refund' },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /maximum refundable/i);
  });

  await t.test('partial refunds accumulate against the ceiling', async () => {
    const booking = await paidBooking();
    const total = booking.pricing.finalMinor;
    const half = Math.floor(total / 2);

    const first = await request(port, 'POST', '/api/v1/payments/bookings/' + booking.id + '/refund', {
      ...aAuth, body: { amountMinor: half, reason: 'Partial refund for a delayed visit' },
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.data.isFullRefund, false);
    assert.equal(first.body.data.remainingRefundableMinor, total - half);

    const tooMuch = await request(port, 'POST', '/api/v1/payments/bookings/' + booking.id + '/refund', {
      ...aAuth, body: { amountMinor: total, reason: 'Trying to refund the full amount again' },
    });
    assert.equal(tooMuch.status, 400, 'the earlier refund counts against the ceiling');

    const rest = await request(port, 'POST', '/api/v1/payments/bookings/' + booking.id + '/refund', {
      ...aAuth, body: { reason: 'Refunding the remainder after review' },
    });
    assert.equal(rest.status, 200);
    assert.equal(rest.body.data.amountMinor, total - half);
    assert.equal(rest.body.data.remainingRefundableMinor, 0);

    const exhausted = await request(port, 'POST', '/api/v1/payments/bookings/' + booking.id + '/refund', {
      ...aAuth, body: { reason: 'One more attempt after a full refund' },
    });
    assert.equal(exhausted.status, 409);
  });

  await t.test('a refund reverses the provider share, not the gross', async () => {
    const booking = await paidBooking();

    await request(port, 'POST', '/api/v1/payments/bookings/' + booking.id + '/refund', {
      ...aAuth, body: { reason: 'Work was not completed to standard' },
    });

    const ledger = await query(
      "SELECT amount_minor FROM provider_earnings WHERE booking_id = $1 AND entry_type = 'refund_reversal'",
      [booking.id],
    );
    assert.equal(ledger.rows.length, 1);
    assert.equal(
      Number(ledger.rows[0].amount_minor),
      -booking.pricing.providerEarningMinor,
      'the reversal debits the provider share, since the platform keeps its commission accounting separate',
    );
  });

  // ---------- earnings ----------

  await t.test('earnings are held until the dispute window closes', async () => {
    const res = await request(port, 'GET', '/api/v1/earnings', pAuth);
    assert.equal(res.status, 200);

    const balance = res.body.data.balance;
    assert.ok(balance.pendingMinor > 0, 'recent jobs are still inside the dispute window');
    assert.equal(
      balance.unpaidMinor,
      balance.availableMinor + balance.pendingMinor,
      'unpaid splits cleanly into available and pending',
    );
    assert.ok(res.body.data.entries.length > 0);
  });

  await t.test('the earnings report reconciles with the statement below it', async () => {
    // The ledger page caps at 50, so the line-by-line check below is only
    // valid while the statement fits on one page.
    const res = await request(port, 'GET', '/api/v1/earnings?limit=50', pAuth);
    assert.equal(res.status, 200);
    const { report, entries, balance, total } = res.body.data;

    assert.ok(report.grossMinor > 0, 'the provider has earned something');
    assert.ok(report.commissionMinor > 0, 'and paid commission on it');

    // The headline claim of the card: gross minus commission minus any
    // adjustment is what the provider keeps. If these drift the provider is
    // reading two different stories on one screen.
    assert.equal(
      report.netMinor,
      report.grossMinor - report.commissionMinor - report.otherDeductionsMinor,
      'net is exactly gross less commission and adjustments',
    );

    // And the summary must agree with the lines it summarises.
    if (total <= entries.length) {
      const fromLines = entries
        .filter((e) => e.type !== 'payout')
        .reduce((sum, e) => sum + e.amountMinor, 0);
      assert.equal(report.netMinor, fromLines, 'the summary equals the statement it sits above');
    }

    // Lifetime counts payouts as money moving, not money lost.
    assert.equal(
      balance.lifetimeMinor,
      report.netMinor - report.paidOutMinor,
      'lifetime is the net less what has already been transferred',
    );

    assert.ok(report.effectiveCommissionPercent > 0 && report.effectiveCommissionPercent <= 50);
  });

  await t.test('a closed dispute window moves earnings into available', async () => {
    const before = await request(port, 'GET', '/api/v1/earnings', pAuth);

    await query(
      `UPDATE provider_earnings SET available_at = NOW() - INTERVAL '1 hour'
        WHERE booking_id IN (SELECT id FROM bookings WHERE description = $1)`,
      [TAG],
    );

    const after = await request(port, 'GET', '/api/v1/earnings', pAuth);
    assert.ok(
      after.body.data.balance.availableMinor > before.body.data.balance.availableMinor,
      'money became payable once the window closed',
    );
  });

  await t.test('a customer cannot read provider earnings', async () => {
    const res = await request(port, 'GET', '/api/v1/earnings', cAuth);
    assert.equal(res.status, 403);
  });

  await t.test('invoices are visible only to their own parties', async () => {
    const mine = await request(port, 'GET', '/api/v1/invoices', cAuth);
    assert.equal(mine.status, 200);
    assert.ok(mine.body.data.length >= 1);
    assert.equal(mine.body.data[0].settlement, undefined, 'a customer does not see the commission split');

    const providerView = await request(port, 'GET', '/api/v1/invoices', pAuth);
    assert.ok(providerView.body.data[0].settlement, 'a provider sees their earning statement');

    const other = await signIn(port, 'electrician@servicesetu.in');
    const invoiceId = mine.body.data[0].id;
    const forbidden = await request(port, 'GET', '/api/v1/invoices/' + invoiceId, {
      token: other.accessToken,
    });
    assert.equal(forbidden.status, 403);
  });

  // ---------- reopening an abandoned checkout ----------

  await t.test('reopening a payment reuses the order the database already holds', async () => {
    const booking = await completedBooking();

    const first = await request(port, 'POST', '/api/v1/payments/orders', {
      ...cAuth, body: { bookingId: booking.id },
    });
    assert.equal(first.status, 201);

    // The customer closed the window and came back.
    const second = await request(port, 'POST', '/api/v1/payments/orders', {
      ...cAuth, body: { bookingId: booking.id },
    });

    assert.equal(second.body.data.reused, true);
    assert.equal(
      second.body.data.payment.orderId,
      first.body.data.payment.orderId,
      'the second attempt must hand back the SAME order id - a new one would not be in the database, and verification would fail after the money moved',
    );

    const rows = await query('SELECT COUNT(*)::int AS c FROM payments WHERE booking_id = $1', [booking.id]);
    assert.equal(rows.rows[0].c, 1, 'no duplicate payment row was created');
  });

  /**
   * The gateway holding money we never recorded.
   *
   * Both ways a payment reaches us can be missed: the webhook (no secret
   * configured, or it simply never arrives) and the browser returning from
   * checkout (tab closed on the success screen). When both are missed the
   * money has moved and the booking still says payment due - and reopening the
   * order sends the customer to a checkout the gateway refuses with "the order
   * is already paid", forever.
   *
   * The driver's network is stubbed rather than mocked at the module boundary,
   * so the real amount check and the real status check both run.
   */
  await t.test('a payment the gateway already holds is settled, not offered again', async () => {
    const booking = await completedBooking();
    const opened = await request(port, 'POST', '/api/v1/payments/orders', {
      ...cAuth, body: { bookingId: booking.id },
    });
    assert.equal(opened.status, 201);

    const row = await queryOne('SELECT * FROM payments WHERE booking_id = $1', [booking.id]);
    assert.equal(row.status, 'pending');

    // Make it look like a Razorpay order, which is the driver that can read an
    // order back. The mock has no gateway to ask.
    await query(
      "UPDATE payments SET gateway = 'razorpay', gateway_order_id = $2 WHERE id = $1",
      [row.id, 'order_stub_' + row.id.slice(0, 8)],
    );
    const pending = await queryOne('SELECT * FROM payments WHERE id = $1', [row.id]);

    const realFetch = globalThis.fetch;
    const realDriver = env.PAYMENT_DRIVER;
    const realKey = env.RAZORPAY_KEY_ID;
    const realSecret = env.RAZORPAY_KEY_SECRET;
    env.PAYMENT_DRIVER = 'razorpay';
    env.RAZORPAY_KEY_ID = env.RAZORPAY_KEY_ID || 'rzp_test_stub';
    env.RAZORPAY_KEY_SECRET = env.RAZORPAY_KEY_SECRET || 'stub-secret';

    const captured = {
      id: 'pay_stub_' + row.id.slice(0, 8),
      status: 'captured',
      amount: Number(pending.amount_minor),
      method: 'upi',
    };

    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(url).includes('/payments') ? { items: [captured] } : {},
    });

    try {
      const settled = await settleFromGateway(pending);
      assert.ok(settled, 'a captured payment must be settled');

      const after = await queryOne('SELECT * FROM payments WHERE id = $1', [row.id]);
      assert.equal(after.status, 'paid', 'the payment row is closed');
      assert.equal(after.gateway_payment_id, captured.id);

      // An invoice proves settlement ran the whole way, not just a status flip.
      const invoice = await queryOne('SELECT id FROM invoices WHERE booking_id = $1', [booking.id]);
      assert.ok(invoice, 'settling issues the invoice');
    } finally {
      globalThis.fetch = realFetch;
      env.PAYMENT_DRIVER = realDriver;
      env.RAZORPAY_KEY_ID = realKey;
      env.RAZORPAY_KEY_SECRET = realSecret;
    }
  });

  await t.test('a captured payment for a different amount is not treated as this one', async () => {
    const booking = await completedBooking();
    const opened = await request(port, 'POST', '/api/v1/payments/orders', {
      ...cAuth, body: { bookingId: booking.id },
    });
    assert.equal(opened.status, 201);

    const row = await queryOne('SELECT * FROM payments WHERE booking_id = $1', [booking.id]);
    await query(
      "UPDATE payments SET gateway = 'razorpay', gateway_order_id = $2 WHERE id = $1",
      [row.id, 'order_stub_x_' + row.id.slice(0, 8)],
    );
    const pending = await queryOne('SELECT * FROM payments WHERE id = $1', [row.id]);

    const realFetch = globalThis.fetch;
    const realDriver = env.PAYMENT_DRIVER;
    env.PAYMENT_DRIVER = 'razorpay';
    env.RAZORPAY_KEY_ID = env.RAZORPAY_KEY_ID || 'rzp_test_stub';
    env.RAZORPAY_KEY_SECRET = env.RAZORPAY_KEY_SECRET || 'stub-secret';

    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(url).includes('/payments')
          ? { items: [{ id: 'pay_other', status: 'captured', amount: 1, method: 'upi' }] }
          : {},
    });

    try {
      const settled = await settleFromGateway(pending);
      assert.equal(settled, null, 'money collected for some other figure is not this order');

      const after = await queryOne('SELECT status FROM payments WHERE id = $1', [row.id]);
      assert.equal(after.status, 'pending', 'the payment is left alone');
    } finally {
      globalThis.fetch = realFetch;
      env.PAYMENT_DRIVER = realDriver;
    }
  });

  await t.test('the mock never advertises a hosted checkout, on either path', async () => {
    // The frontend reads checkout.orderId to decide whether a real gateway
    // window exists. The mock has none, so neither path may carry that field.
    //
    // This is a regression test. `createOrder` omitted it and `checkoutConfig`
    // included it, so the FIRST attempt behaved and every reopen afterwards
    // sent the browser to Razorpay's widget holding `mock_key_production`.
    // Razorpay answered 401 and the customer read "Payment Failed".
    const booking = await completedBooking();

    const opened = await request(port, 'POST', '/api/v1/payments/orders', {
      ...cAuth, body: { bookingId: booking.id },
    });
    assert.equal(opened.status, 201);
    assert.equal(
      opened.body.data.checkout.orderId,
      undefined,
      'a fresh mock order must not look like a hosted checkout',
    );

    const reopened = await request(port, 'POST', '/api/v1/payments/orders', {
      ...cAuth, body: { bookingId: booking.id },
    });
    assert.equal(reopened.body.data.reused, true);
    assert.equal(
      reopened.body.data.checkout.orderId,
      undefined,
      'reopening must describe the mock exactly as opening it did',
    );

    // The order id itself is still returned - on the payment, where it belongs.
    assert.ok(reopened.body.data.payment.orderId, 'the order id is still reachable');
  });

  await t.test('a pending order from a different gateway is retired, not reused', async () => {
    const booking = await completedBooking();

    const first = await request(port, 'POST', '/api/v1/payments/orders', {
      ...cAuth, body: { bookingId: booking.id },
    });
    const originalOrderId = first.body.data.payment.orderId;

    // Simulate the driver having been switched since that row was written -
    // exactly what happens when a project moves from the mock to a real
    // gateway with an unfinished payment already on a booking.
    await query("UPDATE payments SET gateway = 'someotherpsp' WHERE booking_id = $1", [booking.id]);

    const second = await request(port, 'POST', '/api/v1/payments/orders', {
      ...cAuth, body: { bookingId: booking.id },
    });

    assert.equal(second.status, 201);
    assert.equal(second.body.data.reused, false, 'an order from another gateway cannot be reused');
    assert.notEqual(second.body.data.payment.orderId, originalOrderId);

    const retired = await queryOne(
      "SELECT status, failure_code FROM payments WHERE booking_id = $1 AND gateway = 'someotherpsp'",
      [booking.id],
    );
    assert.equal(retired.status, 'failed', 'the stale row is retired so the live-payment index is freed');
    assert.equal(retired.failure_code, 'SUPERSEDED');

    // And the new order is the one the database will recognise on verify.
    const live = await queryOne(
      "SELECT gateway_order_id FROM payments WHERE booking_id = $1 AND status = 'pending'",
      [booking.id],
    );
    assert.equal(live.gateway_order_id, second.body.data.payment.orderId);
  });
});
