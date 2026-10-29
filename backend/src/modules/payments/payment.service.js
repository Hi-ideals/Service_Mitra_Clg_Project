/**
 * Payments, invoicing and the provider earnings ledger.
 *
 * Four rules hold this module together, and each is enforced rather than
 * documented:
 *
 *   1. Amounts are never accepted from the client.
 *   2. Payment status is set only from a signature-verified webhook, never
 *      from the browser redirect the user could tamper with.
 *   3. Webhook handling is idempotent - a retried delivery cannot credit twice.
 *   4. A provider is paid only after the dispute window closes.
 */
import { withTransaction, queryOne, queryMany } from '../../db/pool.js';
import ApiError from '../../utils/ApiError.js';
import { BOOKING_STATUS as S } from '../../config/constants.js';
import { reference, money } from '../../utils/helpers.js';
import { notifyAsync } from '../../services/notification.service.js';
import settings from '../../services/settings.service.js';
import { gateway } from '../../services/payment/gateway.js';
import logger from '../../config/logger.js';
import * as repo from './payment.repository.js';

function presentPayment(p) {
  return {
    id: p.id,
    reference: p.reference,
    bookingId: p.booking_id,
    status: p.status,
    amountMinor: Number(p.amount_minor),
    amount: money.toMajor(p.amount_minor),
    currency: p.currency,
    method: p.method,
    gateway: p.gateway,
    orderId: p.gateway_order_id,
    failureReason: p.failure_reason,
    paidAt: p.paid_at,
    createdAt: p.created_at,
  };
}

/**
 * What a booking currently owes. Taken from the booking's own settled figures,
 * never from anything the caller sent.
 */
function amountDue(booking) {
  if (booking.final_amount_minor !== null && booking.final_amount_minor !== undefined) {
    return Number(booking.final_amount_minor);
  }
  return Number(booking.quoted_amount_minor) + Number(booking.visit_charge_minor ?? 0);
}

/**
 * Settles a payment the gateway already holds but we never recorded.
 *
 * There are two ways a payment is meant to reach us: the webhook, and the
 * browser coming back from checkout. Both can be missed - a webhook secret not
 * configured, a tab closed on the success screen, a phone that lost signal the
 * moment the money moved. When both are missed the gateway has the money and
 * the booking still says payment due, and nothing in the system ever corrects
 * it on its own.
 *
 * Returns the settled payment, or null if the gateway has nothing captured for
 * that order - in which case the caller carries on as before.
 *
 * The amount is checked rather than trusted. A captured payment for some other
 * figure is not this order being paid, and settling on it would close a
 * booking against money that was never collected for it.
 */
export async function settleFromGateway(payment) {
  const driver = gateway();
  if (!driver.fetchOrderPayments || !payment?.gateway_order_id) return null;

  let captured;
  try {
    const items = await driver.fetchOrderPayments(payment.gateway_order_id);
    captured = (items ?? []).find(
      (p) =>
        ['captured', 'authorized'].includes(p.status) &&
        Number(p.amount) === Number(payment.amount_minor),
    );
  } catch (err) {
    // A gateway that cannot be reached is not evidence of anything. Leave the
    // payment as it is and let the next attempt - or the next sweep - decide.
    logger.warn(
      { err: err.message, orderId: payment.gateway_order_id, reference: payment.reference },
      'Could not read the order back from the gateway',
    );
    return null;
  }

  if (!captured) return null;

  logger.warn(
    {
      reference: payment.reference,
      orderId: payment.gateway_order_id,
      gatewayPaymentId: captured.id,
    },
    'Gateway already held this payment - settling a booking that was left owing',
  );

  await settlePayment(
    payment,
    { paymentId: captured.id, amountMinor: Number(captured.amount), method: captured.method ?? null },
    null,
  );

  const fresh = await repo.findById(payment.id);
  return presentPayment(fresh ?? payment);
}

/**
 * Opens a payment for a booking and returns what the checkout widget needs.
 * Creating an order commits us to nothing - only the webhook does that.
 */
export async function createPaymentOrder(bookingId, customerId) {
  const booking = await queryOne(
    `SELECT b.*, c.name AS category_name FROM bookings b
       JOIN service_categories c ON c.id = b.category_id
      WHERE b.id = $1`,
    [bookingId],
  );

  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.customer_id !== customerId) {
    throw ApiError.forbidden('You do not have access to this booking');
  }

  const payable = [S.COMPLETED, S.IN_PROGRESS, S.ACCEPTED];
  if (!payable.includes(booking.status)) {
    throw ApiError.conflict(
      'A ' + booking.status.replace('_', ' ') + ' booking cannot be paid for',
    );
  }

  const driver = gateway();
  const existing = await repo.findLiveForBooking(bookingId);

  if (existing?.status === 'paid') {
    throw ApiError.conflict('This booking has already been paid');
  }

  /**
   * An unfinished order is reused rather than duplicated, so a customer who
   * closed the checkout and came back does not accumulate orphan orders.
   *
   * Reuse means handing back the order id we already stored - NOT minting a
   * new one. Creating a fresh gateway order here would give the browser an id
   * the database has never seen, and verification would then fail with "that
   * payment order does not exist" even though the money had moved.
   *
   * It only applies when the stored order belongs to the gateway currently
   * configured. Switching drivers leaves rows behind that the new gateway has
   * never heard of, and those have to be retired rather than resurrected.
   */
  const reusable =
    existing?.status === 'pending' &&
    existing.gateway === driver.name &&
    existing.gateway_order_id &&
    Number(existing.amount_minor) === amountDue(booking);

  if (reusable) {
    /**
     * Ask the gateway before handing the order back.
     *
     * "Pending" is only our view. If the customer paid and the browser never
     * returned - they closed the tab on the success screen, or the network
     * dropped - the money moved and nothing told us. Reopening that order then
     * sends them to a checkout the gateway refuses with "the order is already
     * paid", and no amount of retrying can ever clear it: the booking says
     * payment due, the gateway says settled, and the customer is stuck.
     *
     * So the gateway is asked first, and a payment it already holds is settled
     * here instead of being offered again.
     */
    const settled = await settleFromGateway(existing);
    if (settled) {
      return { payment: settled, checkout: null, reused: true, alreadySettled: true };
    }

    return {
      payment: presentPayment(existing),
      checkout: driver.checkoutConfig({
        orderId: existing.gateway_order_id,
        amountMinor: Number(existing.amount_minor),
        currency: existing.currency,
        description: booking.category_name,
      }),
      reused: true,
    };
  }

  // A pending order that cannot be reused - wrong gateway, or the amount
  // changed after completion - is retired so the "one live payment per
  // booking" index does not block the new one.
  if (existing?.status === 'pending') {
    await withTransaction((tx) =>
      repo.markFailed(tx, existing.id, {
        code: 'SUPERSEDED',
        reason:
          existing.gateway === driver.name
            ? 'The amount changed, so a new order was created'
            : 'The payment gateway changed, so a new order was created',
      }),
    );

    logger.info(
      { bookingId, previousGateway: existing.gateway, gateway: driver.name },
      'Retired a stale pending payment before creating a new order',
    );
  }

  const amountMinor = amountDue(booking);
  if (amountMinor <= 0) throw ApiError.badRequest('There is nothing to pay on this booking');

  const order = await driver.createOrder({
    amountMinor,
    currency: 'INR',
    reference: reference('PAY'),
    notes: { bookingId, description: booking.category_name },
  });

  const payment = await withTransaction((tx) =>
    repo.create(tx, {
      reference: order.reference,
      bookingId,
      customerId,
      amountMinor,
      currency: 'INR',
      gateway: order.gateway,
      gatewayOrderId: order.orderId,
    }),
  );

  return { payment: presentPayment(payment), checkout: order.checkout, reused: false };
}

/**
 * The invoice's service lines.
 *
 * An invoice has to add up: the lines must total exactly what was charged.
 * The booking's items carry the prices *quoted*, and the amount actually
 * collected can differ - the provider confirms a final figure on completion,
 * after seeing the job. So the quoted lines are listed, and any difference is
 * shown as its own line rather than being silently spread across them. The
 * customer can then see both what they agreed to and what changed.
 *
 * Falls back to the booking's headline category if it somehow has no items,
 * so a missing row can never produce an invoice with no description at all.
 */
function buildLineItems({ bookingItems, booking, serviceAmount, visitCharge }) {
  const visitLine =
    visitCharge > 0 ? [{ description: 'Visit charge', amountMinor: visitCharge }] : [];

  if (!bookingItems.length) {
    return [
      { description: booking.category_name, amountMinor: serviceAmount },
      ...visitLine,
    ];
  }

  const lines = bookingItems.map((item) => ({
    description: item.category_name,
    amountMinor: Number(item.price_minor),
  }));

  const quoted = lines.reduce((sum, line) => sum + line.amountMinor, 0);
  const difference = serviceAmount - quoted;

  if (difference !== 0) {
    lines.push({
      description:
        difference > 0
          ? 'Additional work agreed on completion'
          : 'Reduction agreed on completion',
      amountMinor: difference,
    });
  }

  return [...lines, ...visitLine];
}

/**
 * Handles a gateway webhook.
 *
 * This is the only place a payment becomes "paid". The browser redirect that
 * follows a checkout is treated as a hint to refresh the UI, nothing more.
 */
export async function handleWebhook({ rawBody, signature, parsedBody }) {
  const driver = gateway();
  const signatureValid = driver.verifySignature(rawBody, signature);
  const event = driver.parseEvent(parsedBody);

  if (!event.eventId) {
    throw ApiError.badRequest('Webhook payload has no event id');
  }

  // Recorded before it is acted on - an invalid signature is evidence worth
  // keeping, not just a rejection.
  const recorded = await repo.recordEvent({
    gateway: driver.name,
    eventId: event.eventId,
    type: event.type,
    signatureValid,
    payload: parsedBody,
  });

  if (!signatureValid) {
    logger.warn({ eventId: event.eventId, type: event.type }, 'Rejected webhook with an invalid signature');
    throw ApiError.forbidden('Invalid webhook signature');
  }

  // recordEvent returns null when the unique index caught a duplicate, which
  // is exactly what a retried delivery looks like.
  if (!recorded) {
    const previous = await repo.findEvent(driver.name, event.eventId);
    return { duplicate: true, alreadyProcessedAt: previous?.processed_at ?? null };
  }

  try {
    const result = await applyEvent(event, signature);
    await repo.markEventProcessed(recorded.id);
    return { duplicate: false, ...result };
  } catch (err) {
    await repo.markEventProcessed(recorded.id, err.message);
    throw err;
  }
}

async function applyEvent(event, signature) {
  const payment = await repo.findByOrderId(gateway().name, event.orderId);
  if (!payment) {
    // Not an error the gateway should retry - the order is simply not ours.
    logger.warn({ orderId: event.orderId }, 'Webhook for an unknown order');
    return { handled: false, reason: 'unknown_order' };
  }

  // Razorpay sends payment.captured; the mock sends the same. Authorised but
  // not captured is treated as paid too, since our orders are auto-capture.
  if (event.type === 'payment.captured' || event.type === 'payment.authorized') {
    if (payment.status === 'paid') return { handled: true, status: 'paid', noop: true };

    // The gateway is authoritative on the amount actually collected.
    if (event.amountMinor !== null && Number(event.amountMinor) !== Number(payment.amount_minor)) {
      throw ApiError.badRequest(
        'Webhook amount ' + event.amountMinor + ' does not match the order amount ' + payment.amount_minor,
      );
    }

    await settlePayment(payment, event, signature);
    return { handled: true, status: 'paid' };
  }

  if (event.type === 'payment.failed') {
    await withTransaction((tx) =>
      repo.markFailed(tx, payment.id, { code: event.errorCode, reason: event.errorReason }),
    );
    notifyAsync({
      userId: payment.customer_id,
      eventType: 'payment.failed',
      title: 'Payment failed',
      body: (event.errorReason || 'Your payment did not go through') + '. You can try again.',
      entityType: 'payment',
      entityId: payment.id,
    });
    return { handled: true, status: 'failed' };
  }

  return { handled: false, reason: 'unhandled_event_type' };
}

/**
 * Marks the payment paid, issues the invoice and writes the earnings ledger -
 * all in one transaction, because a payment recorded without its invoice or
 * its ledger entries would be a reconciliation problem later.
 */
async function settlePayment(payment, event, signature) {
  const booking = await queryOne(
    `SELECT b.*, c.name AS category_name, p.user_id AS provider_user_id
       FROM bookings b
       JOIN service_categories c ON c.id = b.category_id
       JOIN provider_profiles p ON p.id = b.provider_id
      WHERE b.id = $1`,
    [payment.booking_id],
  );

  // Every service on the booking, so a two-service visit produces a two-line
  // invoice rather than one line naming only the first.
  const bookingItems = await queryMany(
    `SELECT c.name AS category_name, bi.price_minor
       FROM booking_items bi
       JOIN service_categories c ON c.id = bi.category_id
      WHERE bi.booking_id = $1
      ORDER BY bi.position, c.name`,
    [booking.id],
  );

  const tax = await settings.get('tax');
  const bookingRules = await settings.get('booking');

  const total = Number(payment.amount_minor);
  const visitCharge = Number(booking.visit_charge_minor ?? 0);
  const serviceAmount = total - visitCharge;

  const commissionPercent = Number(booking.commission_percent);
  const commissionMinor =
    booking.commission_amount_minor ?? Math.round((total * commissionPercent) / 100);
  const providerEarningMinor = booking.provider_earning_minor ?? total - commissionMinor;

  // Provider earnings are held until the dispute window closes.
  const availableAt =
    booking.dispute_window_ends_at ??
    new Date(Date.now() + (bookingRules.disputeWindowHours ?? 48) * 3600000);

  await withTransaction(async (tx) => {
    await repo.markPaid(tx, payment.id, {
      gatewayPaymentId: event.paymentId,
      method: event.method,
      signature,
    });

    const prefix = 'INV-' + new Date().getFullYear() + '-';
    const seq = await repo.nextInvoiceSequence(tx, prefix);

    await repo.createInvoice(tx, {
      invoiceNumber: prefix + String(seq.next).padStart(5, '0'),
      bookingId: booking.id,
      customerId: booking.customer_id,
      providerId: booking.provider_id,
      paymentId: payment.id,
      serviceAmountMinor: serviceAmount,
      visitChargeMinor: visitCharge,
      // Tax is shown as a component of the total collected, not added on top -
      // the customer was quoted an inclusive figure.
      taxAmountMinor: tax.inclusive
        ? Math.round(total - total / (1 + tax.gstPercent / 100))
        : 0,
      discountMinor: 0,
      totalAmountMinor: total,
      commissionMinor,
      providerEarningMinor,
      lineItems: buildLineItems({ bookingItems, booking, serviceAmount, visitCharge }),
    });

    // Two ledger rows, not one: the gross earning and the commission deducted
    // from it, so a provider statement shows what was taken and why.
    await repo.addLedgerEntry(tx, {
      providerId: booking.provider_id,
      bookingId: booking.id,
      entryType: 'job_earning',
      amountMinor: total,
      description:
        (bookingItems.length > 1
          ? bookingItems.map((i) => i.category_name).join(' + ')
          : booking.category_name) +
        ' (' + booking.reference + ')',
      availableAt,
    });

    await repo.addLedgerEntry(tx, {
      providerId: booking.provider_id,
      bookingId: booking.id,
      entryType: 'commission',
      amountMinor: -commissionMinor,
      description: 'Platform commission at ' + commissionPercent + '%',
      availableAt,
    });
  });

  notifyAsync({
    userId: booking.customer_id,
    eventType: 'payment.succeeded',
    title: 'Payment received',
    body: 'We have received ' + money.format(total) + ' for booking ' + booking.reference + '. Your invoice is ready.',
    entityType: 'booking',
    entityId: booking.id,
  });

  notifyAsync({
    userId: booking.provider_user_id,
    eventType: 'payment.received',
    title: 'Payment received for your job',
    body:
      money.format(providerEarningMinor) + ' has been credited to your balance for booking ' +
      booking.reference + '. It becomes payable on ' + new Date(availableAt).toLocaleDateString('en-IN') + '.',
    entityType: 'booking',
    entityId: booking.id,
  });
}

/**
 * Settles a payment from the browser's checkout handshake.
 *
 * This exists because a webhook cannot reach localhost, so during development
 * a completed checkout would otherwise leave the payment stuck as pending
 * forever. It is safe in production too, and worth keeping: a webhook that
 * never arrives is a real failure mode, and this gives the customer a way out
 * of it that does not involve support.
 *
 * It is NOT trusting the browser. Two independent checks have to pass:
 *
 *   1. The handshake signature, which only the key secret can produce.
 *   2. The payment read back from the gateway's own API, confirming it really
 *      was captured and for the right amount.
 *
 * The browser is the messenger, not the authority.
 */
export async function verifyCheckout({ bookingId, orderId, paymentId, signature, customerId }) {
  const driver = gateway();

  const payment = await repo.findByOrderId(driver.name, orderId);
  if (!payment) throw ApiError.notFound('That payment order does not exist');

  if (payment.customer_id !== customerId) {
    throw ApiError.forbidden('This payment does not belong to you');
  }

  if (payment.booking_id !== bookingId) {
    throw ApiError.badRequest('That order belongs to a different booking');
  }

  // Already settled by a webhook that beat the browser back. Not an error.
  if (payment.status === 'paid') {
    return { status: 'paid', alreadySettled: true };
  }

  if (!driver.verifyCheckoutSignature({ orderId, paymentId, signature })) {
    logger.warn({ orderId, paymentId }, 'Rejected a checkout handshake with an invalid signature');
    throw ApiError.forbidden('That payment confirmation could not be verified');
  }

  // The signature proves the browser talked to the gateway. It does not prove
  // the money moved, so ask the gateway directly.
  let confirmed = null;
  if (driver.fetchPayment) {
    confirmed = await driver.fetchPayment(paymentId);

    const settled = ['captured', 'authorized'].includes(confirmed.status);
    if (!settled) {
      throw ApiError.conflict(
        'The gateway reports this payment as ' + confirmed.status + ', not completed.',
      );
    }

    if (Number(confirmed.amount) !== Number(payment.amount_minor)) {
      throw ApiError.badRequest('The amount the gateway collected does not match the order');
    }
  }

  await settlePayment(
    payment,
    {
      paymentId,
      amountMinor: confirmed ? confirmed.amount : Number(payment.amount_minor),
      method: confirmed ? confirmed.method : null,
    },
    signature,
  );

  return { status: 'paid', alreadySettled: false };
}

// ---------------------------------------------------------------- reads

export async function getPaymentStatus(bookingId, actor) {
  const booking = await queryOne(
    'SELECT customer_id, provider_id, status FROM bookings WHERE id = $1',
    [bookingId],
  );
  if (!booking) throw ApiError.notFound('Booking not found');

  const allowed =
    actor.type === 'admin' ||
    (actor.type === 'customer' && booking.customer_id === actor.id) ||
    (actor.type === 'provider' && booking.provider_id === actor.providerId);

  if (!allowed) throw ApiError.forbidden('You do not have access to this booking');

  const [payments, refunds, invoice] = await Promise.all([
    repo.listForBooking(bookingId),
    repo.listRefunds(bookingId),
    repo.findInvoiceByBooking(bookingId),
  ]);

  return {
    payments: payments.map(presentPayment),
    isPaid: payments.some((p) => p.status === 'paid'),
    refunds: refunds.map((r) => ({
      id: r.id,
      reference: r.reference,
      amountMinor: Number(r.amount_minor),
      amount: money.toMajor(r.amount_minor),
      reason: r.reason,
      status: r.status,
      processedAt: r.processed_at,
    })),
    invoiceId: invoice?.id ?? null,
  };
}

// ---------------------------------------------------------------- refunds

/**
 * Issues a refund against a paid booking.
 *
 * The ceiling is what was actually collected minus what has already been
 * refunded, so repeated partial refunds cannot quietly exceed the payment.
 * The provider's ledger is reversed in the same transaction.
 */
export async function refund({ bookingId, amountMinor, reason, initiatedBy, adminId }) {
  const payment = await repo.findRefundablePayment(bookingId);
  if (!payment) {
    throw ApiError.conflict('This booking has no completed payment to refund');
  }

  const already = await repo.refundedTotal(payment.id);
  const remaining = Number(payment.amount_minor) - Number(already.total);

  if (remaining <= 0) {
    throw ApiError.conflict('This payment has already been fully refunded');
  }

  const requested = amountMinor ?? remaining;

  if (requested <= 0) throw ApiError.badRequest('The refund amount must be greater than zero');
  if (requested > remaining) {
    throw ApiError.badRequest(
      'The maximum refundable amount is ' + money.format(remaining) +
        ' (' + money.format(already.total) + ' has already been refunded)',
    );
  }

  const booking = await queryOne(
    `SELECT b.reference, b.provider_id, b.customer_id, b.commission_percent,
            p.user_id AS provider_user_id
       FROM bookings b JOIN provider_profiles p ON p.id = b.provider_id
      WHERE b.id = $1`,
    [bookingId],
  );

  const gatewayResult = await gateway().refund({
    paymentId: payment.gateway_payment_id,
    amountMinor: requested,
    reason,
  });

  const isFull = requested === remaining && Number(already.total) === 0;

  const result = await withTransaction(async (tx) => {
    const created = await repo.createRefund(tx, {
      reference: reference('RFD'),
      paymentId: payment.id,
      bookingId,
      amountMinor: requested,
      reason,
      initiatedBy,
      adminId,
    });

    const completed = await repo.completeRefund(tx, created.id, gatewayResult.refundId);

    await repo.setRefundStatus(
      tx,
      payment.id,
      requested + Number(already.total) >= Number(payment.amount_minor)
        ? 'refunded'
        : 'partially_refunded',
    );

    // Reverse the provider's share of what was refunded, proportionally.
    const commissionPercent = Number(booking.commission_percent);
    const providerShare = requested - Math.round((requested * commissionPercent) / 100);

    await repo.addLedgerEntry(tx, {
      providerId: booking.provider_id,
      bookingId,
      entryType: 'refund_reversal',
      amountMinor: -providerShare,
      description: 'Refund on booking ' + booking.reference + ': ' + reason,
      availableAt: new Date(),
    });

    return completed;
  });

  notifyAsync({
    userId: booking.customer_id,
    eventType: 'payment.refunded',
    title: isFull ? 'Refund issued' : 'Partial refund issued',
    body:
      money.format(requested) + ' has been refunded for booking ' + booking.reference +
      '. It should reach your account within 5 to 7 working days.',
    entityType: 'booking',
    entityId: bookingId,
  });

  notifyAsync({
    userId: booking.provider_user_id,
    eventType: 'payment.refunded',
    title: 'A refund was issued on your job',
    body:
      money.format(requested) + ' was refunded on booking ' + booking.reference +
      '. Your balance has been adjusted. Reason: ' + reason,
    entityType: 'booking',
    entityId: bookingId,
  });

  return {
    id: result.id,
    reference: result.reference,
    amountMinor: Number(result.amount_minor),
    amount: money.toMajor(result.amount_minor),
    status: result.status,
    isFullRefund: isFull,
    remainingRefundableMinor: remaining - requested,
  };
}

// ---------------------------------------------------------------- earnings

export async function earnings(providerId, { limit, offset }) {
  const [bal, entries, summary, byMonth] = await Promise.all([
    repo.balance(providerId),
    repo.ledger({ providerId, limit, offset }),
    repo.earningsSummary(providerId),
    repo.earningsByMonth(providerId, 6),
  ]);

  const gross = Number(summary.gross);
  const commission = Number(summary.commission);

  return {
    /**
     * What was earned and what the platform took, in that order.
     *
     * The balance cards above answer "when do I get it"; this answers "what
     * did I make and what did it cost me" - which is the question a provider
     * actually asks at the end of a month.
     */
    report: {
      grossMinor: gross,
      gross: money.toMajor(gross),
      commissionMinor: commission,
      commission: money.toMajor(commission),
      otherDeductionsMinor: Number(summary.other_deductions),
      otherDeductions: money.toMajor(summary.other_deductions),
      netMinor: Number(summary.net),
      net: money.toMajor(summary.net),
      paidOutMinor: Number(summary.paid_out),
      paidOut: money.toMajor(summary.paid_out),
      jobs: summary.jobs,
      averagePerJob: money.toMajor(summary.jobs ? Math.round(gross / summary.jobs) : 0),
      // The rate they actually paid, not the headline rate. Adjustments and
      // per-booking commission changes make the two differ.
      effectiveCommissionPercent: gross ? Math.round((commission / gross) * 1000) / 10 : 0,
      since: summary.first_earning_at,
    },
    byMonth: byMonth.map((m) => ({
      period: m.period_key,
      label: m.period_label,
      grossMinor: Number(m.gross),
      gross: money.toMajor(m.gross),
      commission: money.toMajor(m.commission),
      net: money.toMajor(m.net),
      jobs: m.jobs,
    })),
    balance: {
      lifetimeMinor: Number(bal.lifetime),
      lifetime: money.toMajor(bal.lifetime),
      // Payable now: the dispute window on these jobs has closed.
      availableMinor: Number(bal.available),
      available: money.toMajor(bal.available),
      // Earned but still inside the dispute window.
      pendingMinor: Number(bal.pending),
      pending: money.toMajor(bal.pending),
      unpaidMinor: Number(bal.unpaid),
    },
    entries: entries.items.map((e) => ({
      id: e.id,
      type: e.entry_type,
      amountMinor: Number(e.amount_minor),
      amount: money.toMajor(e.amount_minor),
      description: e.description,
      bookingReference: e.booking_reference,
      availableAt: e.available_at,
      isPaidOut: Boolean(e.payout_id),
      // Which transfer carried this away, so a job can show that it has been
      // settled and name the payout it went out in.
      payoutReference: e.payout_reference ?? null,
      // Only set on the payout line itself: how many separate visits that one
      // transfer covered.
      coversBookings: e.covers_bookings ?? null,
      createdAt: e.created_at,
    })),
    total: entries.total,
  };
}

export { presentPayment, amountDue };

export default {
  createPaymentOrder, handleWebhook, verifyCheckout, getPaymentStatus, refund, earnings,
};
