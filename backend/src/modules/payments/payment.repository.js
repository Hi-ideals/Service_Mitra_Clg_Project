/** Data access for the financial domain. */
import { query, queryOne, queryMany } from '../../db/pool.js';

const PAYMENT = `
  p.id, p.reference, p.booking_id, p.customer_id, p.status, p.amount_minor,
  p.currency, p.method, p.gateway, p.gateway_order_id, p.gateway_payment_id,
  p.failure_code, p.failure_reason, p.authorized_at, p.paid_at, p.failed_at,
  p.created_at, p.updated_at
`;

export function findById(id) {
  return queryOne(`SELECT ${PAYMENT} FROM payments p WHERE p.id = $1`, [id]);
}

export function findByOrderId(gateway, orderId) {
  return queryOne(
    `SELECT ${PAYMENT} FROM payments p WHERE p.gateway = $1 AND p.gateway_order_id = $2`,
    [gateway, orderId],
  );
}

/** The payment currently live for a booking, if any. */
export function findLiveForBooking(bookingId) {
  return queryOne(
    `SELECT ${PAYMENT} FROM payments p
      WHERE p.booking_id = $1 AND p.status IN ('pending','authorized','paid')
      ORDER BY p.created_at DESC LIMIT 1`,
    [bookingId],
  );
}

/**
 * The payment a refund may be issued against.
 *
 * Deliberately wider than findLiveForBooking: once a partial refund lands the
 * payment is no longer "live", but it is still refundable up to its remaining
 * balance. Using the narrower lookup here made a second partial refund
 * impossible.
 */
export function findRefundablePayment(bookingId) {
  return queryOne(
    `SELECT ${PAYMENT} FROM payments p
      WHERE p.booking_id = $1 AND p.status IN ('paid','partially_refunded')
      ORDER BY p.created_at DESC LIMIT 1`,
    [bookingId],
  );
}

export function listForBooking(bookingId) {
  return queryMany(
    `SELECT ${PAYMENT} FROM payments p WHERE p.booking_id = $1 ORDER BY p.created_at DESC`,
    [bookingId],
  );
}

export function create(tx, d) {
  return tx.one(
    `INSERT INTO payments
       (reference, booking_id, customer_id, amount_minor, currency, gateway, gateway_order_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING ${PAYMENT.replaceAll('p.', '')}`,
    [d.reference, d.bookingId, d.customerId, d.amountMinor, d.currency, d.gateway, d.gatewayOrderId],
  );
}

export function markPaid(tx, id, { gatewayPaymentId, method, signature }) {
  return tx.one(
    `UPDATE payments
        SET status = 'paid', paid_at = NOW(), gateway_payment_id = $2,
            method = COALESCE($3, method), gateway_signature = COALESCE($4, gateway_signature)
      WHERE id = $1
      RETURNING ${PAYMENT.replaceAll('p.', '')}`,
    [id, gatewayPaymentId, method ?? null, signature ?? null],
  );
}

export function markFailed(tx, id, { code, reason }) {
  return tx.one(
    `UPDATE payments
        SET status = 'failed', failed_at = NOW(), failure_code = $2, failure_reason = $3
      WHERE id = $1
      RETURNING ${PAYMENT.replaceAll('p.', '')}`,
    [id, code ?? null, reason ?? null],
  );
}

export function setRefundStatus(tx, id, status) {
  return tx.one(
    `UPDATE payments SET status = $2 WHERE id = $1 RETURNING ${PAYMENT.replaceAll('p.', '')}`,
    [id, status],
  );
}

// ---------- webhook events ----------

/**
 * Records a delivery. The unique index on (gateway, gateway_event_id) is what
 * makes webhook handling idempotent: a retried delivery conflicts here and is
 * recognised as already seen rather than credited twice.
 */
export async function recordEvent({ gateway, eventId, type, signatureValid, payload, paymentId }) {
  const { rows } = await query(
    `INSERT INTO payment_events
       (gateway, gateway_event_id, event_type, signature_valid, payload, payment_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (gateway, gateway_event_id) DO NOTHING
     RETURNING id`,
    [gateway, eventId, type, signatureValid, JSON.stringify(payload), paymentId ?? null],
  );
  return rows[0] ?? null;
}

export function markEventProcessed(id, error = null) {
  return query(
    `UPDATE payment_events SET processed_at = NOW(), processing_error = $2 WHERE id = $1`,
    [id, error],
  );
}

export function findEvent(gateway, eventId) {
  return queryOne(
    `SELECT id, processed_at, processing_error FROM payment_events
      WHERE gateway = $1 AND gateway_event_id = $2`,
    [gateway, eventId],
  );
}

export default {
  findById, findByOrderId, findLiveForBooking, findRefundablePayment, listForBooking, create,
  markPaid, markFailed, setRefundStatus, recordEvent, markEventProcessed, findEvent,
};

// ---------- invoices ----------

export function findInvoiceByBooking(bookingId) {
  return queryOne('SELECT * FROM invoices WHERE booking_id = $1', [bookingId]);
}

export function createInvoice(tx, d) {
  return tx.one(
    `INSERT INTO invoices
       (invoice_number, booking_id, customer_id, provider_id, payment_id,
        service_amount_minor, visit_charge_minor, tax_amount_minor, discount_minor,
        total_amount_minor, commission_minor, provider_earning_minor, line_items)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (booking_id) DO NOTHING
     RETURNING *`,
    [
      d.invoiceNumber, d.bookingId, d.customerId, d.providerId, d.paymentId,
      d.serviceAmountMinor, d.visitChargeMinor, d.taxAmountMinor, d.discountMinor,
      d.totalAmountMinor, d.commissionMinor, d.providerEarningMinor,
      JSON.stringify(d.lineItems),
    ],
  );
}

/** Invoice numbers are sequential per financial year, not random. */
export function nextInvoiceSequence(tx, prefix) {
  return tx.one(
    `SELECT COUNT(*)::int + 1 AS next FROM invoices WHERE invoice_number LIKE $1`,
    [prefix + '%'],
  );
}

export async function listInvoices({ customerId, providerId, limit, offset }) {
  const where = [];
  const params = [];
  const push = (v) => {
    params.push(v);
    return '$' + params.length;
  };

  if (customerId) where.push(`i.customer_id = ${push(customerId)}`);
  if (providerId) where.push(`i.provider_id = ${push(providerId)}`);
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const totalRow = await queryOne(`SELECT COUNT(*)::int AS total FROM invoices i ${clause}`, params);

  params.push(limit, offset);
  const items = await queryMany(
    `SELECT i.*, b.reference AS booking_reference, c.name AS category_name,
            /* Every service on the booking, so an invoice for a visit
               covering two jobs is not headed by only the first. */
            (SELECT string_agg(sc.name, ', ' ORDER BY bi.position, sc.name)
               FROM booking_items bi
               JOIN service_categories sc ON sc.id = bi.category_id
              WHERE bi.booking_id = b.id) AS service_names,
            u.full_name AS customer_name, pu.full_name AS provider_name,
            pp.business_name AS provider_business_name
       FROM invoices i
       JOIN bookings b ON b.id = i.booking_id
       JOIN service_categories c ON c.id = b.category_id
       JOIN users u ON u.id = i.customer_id
       JOIN provider_profiles pp ON pp.id = i.provider_id
       JOIN users pu ON pu.id = pp.user_id
       ${clause}
       ORDER BY i.issued_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { items, total: totalRow.total };
}

export function findInvoice(id) {
  return queryOne(
    `SELECT i.*, b.reference AS booking_reference, b.scheduled_start, b.address_line,
            b.address_city, b.address_state, b.address_pincode,
            c.name AS category_name,
            /* Every service on the booking, so an invoice for a visit
               covering two jobs is not headed by only the first. */
            (SELECT string_agg(sc.name, ', ' ORDER BY bi.position, sc.name)
               FROM booking_items bi
               JOIN service_categories sc ON sc.id = bi.category_id
              WHERE bi.booking_id = b.id) AS service_names,
            u.full_name AS customer_name, u.email AS customer_email, u.phone AS customer_phone,
            pu.full_name AS provider_name, pp.business_name AS provider_business_name
       FROM invoices i
       JOIN bookings b ON b.id = i.booking_id
       JOIN service_categories c ON c.id = b.category_id
       JOIN users u ON u.id = i.customer_id
       JOIN provider_profiles pp ON pp.id = i.provider_id
       JOIN users pu ON pu.id = pp.user_id
      WHERE i.id = $1`,
    [id],
  );
}

// ---------- refunds ----------

export function createRefund(tx, d) {
  return tx.one(
    `INSERT INTO refunds
       (reference, payment_id, booking_id, amount_minor, reason, initiated_by, admin_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')
     RETURNING *`,
    [d.reference, d.paymentId, d.bookingId, d.amountMinor, d.reason, d.initiatedBy, d.adminId],
  );
}

export function completeRefund(tx, id, gatewayRefundId) {
  return tx.one(
    `UPDATE refunds SET status = 'completed', processed_at = NOW(), gateway_refund_id = $2
      WHERE id = $1 RETURNING *`,
    [id, gatewayRefundId],
  );
}

/** Total already refunded against a payment - the ceiling for any new refund. */
export function refundedTotal(paymentId) {
  return queryOne(
    `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS total
       FROM refunds WHERE payment_id = $1 AND status IN ('pending','processing','completed')`,
    [paymentId],
  );
}

export function listRefunds(bookingId) {
  return queryMany('SELECT * FROM refunds WHERE booking_id = $1 ORDER BY created_at DESC', [bookingId]);
}

// ---------- earnings ledger ----------

export function addLedgerEntry(tx, d) {
  return tx.one(
    `INSERT INTO provider_earnings
       (provider_id, booking_id, entry_type, amount_minor, description, available_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, entry_type, amount_minor, available_at, created_at`,
    [d.providerId, d.bookingId, d.entryType, d.amountMinor, d.description, d.availableAt ?? null],
  );
}

/** Balance split into what is payable now and what is still held. */
export function balance(providerId) {
  return queryOne(
    `SELECT
       COALESCE(SUM(amount_minor), 0)::bigint AS lifetime,
       COALESCE(SUM(amount_minor) FILTER (WHERE payout_id IS NULL), 0)::bigint AS unpaid,
       COALESCE(SUM(amount_minor) FILTER (
         WHERE payout_id IS NULL AND (available_at IS NULL OR available_at <= NOW())
       ), 0)::bigint AS available,
       COALESCE(SUM(amount_minor) FILTER (
         WHERE payout_id IS NULL AND available_at > NOW()
       ), 0)::bigint AS pending
     FROM provider_earnings WHERE provider_id = $1`,
    [providerId],
  );
}

/**
 * What a provider has earned, and what the platform took, over all time.
 *
 * Derived from the ledger rather than from bookings, so the figures reconcile
 * with the statement below them line for line. A provider who adds up their
 * own statement must get the same number this returns, or one of the two is
 * lying.
 *
 * Payout entries are excluded from `net`: a transfer out is money moving, not
 * money earned, and counting it would make a paid provider look unpaid.
 */
export function earningsSummary(providerId) {
  return queryOne(
    `SELECT
       COALESCE(SUM(amount_minor) FILTER (WHERE entry_type = 'job_earning'), 0)::bigint AS gross,
       -- Stored negative; returned positive, because "commission paid" reads
       -- as a cost, not as a negative earning.
       COALESCE(-SUM(amount_minor) FILTER (WHERE entry_type = 'commission'), 0)::bigint AS commission,
       COALESCE(-SUM(amount_minor) FILTER (
         WHERE entry_type IN ('penalty', 'refund_reversal', 'adjustment')
       ), 0)::bigint AS other_deductions,
       COALESCE(SUM(amount_minor) FILTER (WHERE entry_type <> 'payout'), 0)::bigint AS net,
       COALESCE(-SUM(amount_minor) FILTER (WHERE entry_type = 'payout'), 0)::bigint AS paid_out,
       COUNT(DISTINCT booking_id) FILTER (WHERE entry_type = 'job_earning')::int AS jobs,
       MIN(created_at) FILTER (WHERE entry_type = 'job_earning') AS first_earning_at
     FROM provider_earnings WHERE provider_id = $1`,
    [providerId],
  );
}

/**
 * The same figures month by month.
 *
 * generate_series fills the empty months, so a quiet month reads as a zero
 * rather than vanishing and making the list look shorter than the period.
 */
export function earningsByMonth(providerId, months = 6) {
  return queryMany(
    `WITH periods AS (
       SELECT generate_series(
         date_trunc('month', NOW()) - (($2::int - 1) || ' months')::interval,
         date_trunc('month', NOW()),
         '1 month'::interval
       ) AS period
     )
     SELECT p.period,
            -- Formatted in SQL, in the same timezone the truncation used. Sent
            -- as a timestamp it would be converted again in the browser, and a
            -- job on the 1st of a month would be reported under the previous
            -- one for anyone east of UTC.
            to_char(p.period, 'Mon YYYY') AS period_label,
            to_char(p.period, 'YYYY-MM') AS period_key,
            COALESCE(SUM(e.amount_minor) FILTER (WHERE e.entry_type = 'job_earning'), 0)::bigint AS gross,
            COALESCE(-SUM(e.amount_minor) FILTER (WHERE e.entry_type = 'commission'), 0)::bigint AS commission,
            COALESCE(SUM(e.amount_minor) FILTER (WHERE e.entry_type <> 'payout'), 0)::bigint AS net,
            COUNT(DISTINCT e.booking_id) FILTER (WHERE e.entry_type = 'job_earning')::int AS jobs
       FROM periods p
       LEFT JOIN provider_earnings e
         ON date_trunc('month', e.created_at) = p.period
        AND e.provider_id = $1
      GROUP BY p.period
      ORDER BY p.period DESC`,
    [providerId, months],
  );
}

export async function ledger({ providerId, limit, offset }) {
  const totalRow = await queryOne(
    'SELECT COUNT(*)::int AS total FROM provider_earnings WHERE provider_id = $1',
    [providerId],
  );

  const items = await queryMany(
    // The payout reference ties a job's earning to the transfer that carried
    // it away, which is what lets the statement say "sent" against the job
    // rather than only against the payout. `covers` answers the other half:
    // a payout sweeps every available earning the provider has, so one
    // transfer routinely settles several visits at once.
    `SELECT e.id, e.entry_type, e.amount_minor, e.description, e.available_at,
            e.payout_id, e.created_at, b.reference AS booking_reference,
            po.reference AS payout_reference,
            CASE WHEN e.entry_type = 'payout' THEN (
              SELECT COUNT(DISTINCT c.booking_id)::int
                FROM provider_earnings c
               WHERE c.payout_id = e.payout_id AND c.booking_id IS NOT NULL
            ) END AS covers_bookings
       FROM provider_earnings e
       LEFT JOIN bookings b ON b.id = e.booking_id
       LEFT JOIN payouts po ON po.id = e.payout_id
      WHERE e.provider_id = $1
      ORDER BY e.created_at DESC
      LIMIT $2 OFFSET $3`,
    [providerId, limit, offset],
  );

  return { items, total: totalRow.total };
}
