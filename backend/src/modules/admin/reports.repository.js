/**
 * Reporting queries.
 *
 * Deliberately separate from analytics. Analytics answers "how are we doing"
 * with aggregates; a report answers "show me the rows" - one line per booking
 * or per payout, filterable, exportable, and reconcilable against a bank
 * statement. The two have different shapes and different consumers, and
 * merging them would make both worse.
 *
 * Every money column is returned in minor units. Formatting is the caller's
 * problem; rounding in SQL is how reports stop adding up.
 */
import { queryMany, queryOne } from '../../db/pool.js';
import { COLLECTED } from '../../utils/revenue.js';

/**
 * Builds a WHERE clause from optional filters.
 *
 * Returns the clause and its parameters together so a caller can never pass
 * the two out of step - the commonest way a filtered query silently returns
 * the wrong rows.
 */
function buildFilters(parts) {
  const where = [];
  const params = [];

  for (const [sql, value] of parts) {
    if (value === undefined || value === null || value === '') continue;
    params.push(value);
    where.push(sql.replace('?', '$' + params.length));
  }

  return { clause: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

/** Filters shared by the services report's rows and its totals. */
function serviceFilters({ from, to, status, categoryId, providerId, city }) {
  return buildFilters([
    ['b.created_at >= ?::timestamptz', from],
    ['b.created_at < ?::timestamptz', to],
    ['b.status = ?::booking_status', status],
    ['EXISTS (SELECT 1 FROM booking_items bi WHERE bi.booking_id = b.id AND bi.category_id = ?)', categoryId],
    ['b.provider_id = ?', providerId],
    ['b.address_city ILIKE ?', city],
  ]);
}

/**
 * One row per booking, with the money and the people attached.
 *
 * The payment is pulled through a lateral rather than a join: a booking can
 * carry several payment attempts, and a plain join would duplicate the booking
 * row once per attempt and double-count every amount in the export.
 */
export function serviceRows(filters, { limit, offset }) {
  const { clause, params } = serviceFilters(filters);

  return queryMany(
    `SELECT b.id, b.reference, b.status, b.created_at, b.scheduled_start, b.completed_at,
            b.address_city, b.address_state, b.address_pincode,
            b.quoted_amount_minor, b.visit_charge_minor, b.final_amount_minor,
            b.commission_percent, b.commission_amount_minor, b.provider_earning_minor,
            b.cancelled_by, b.cancellation_reason, b.rejection_reason,
            c.name AS category_name,
            (
              SELECT string_agg(sc.name, ', ' ORDER BY bi.position, sc.name)
                FROM booking_items bi
                JOIN service_categories sc ON sc.id = bi.category_id
               WHERE bi.booking_id = b.id
            ) AS service_names,
            COALESCE(pp.business_name, pu.full_name) AS provider_name,
            cu.full_name AS customer_name,
            pay.status AS payment_status,
            pay.method AS payment_method,
            pay.paid_at,
            r.rating
       FROM bookings b
       JOIN service_categories c ON c.id = b.category_id
       JOIN provider_profiles pp ON pp.id = b.provider_id
       JOIN users pu ON pu.id = pp.user_id
       JOIN users cu ON cu.id = b.customer_id
       LEFT JOIN LATERAL (
         SELECT status, method, paid_at
           FROM payments
          WHERE booking_id = b.id
          ORDER BY (status = 'paid') DESC, created_at DESC
          LIMIT 1
       ) pay ON TRUE
       LEFT JOIN reviews r ON r.booking_id = b.id
       ${clause}
       ORDER BY b.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
}

/**
 * The totals for the same filtered set.
 *
 * Computed in SQL over every matching row, never summed from the current page.
 * A total that only covers page one is worse than no total at all, because it
 * looks authoritative.
 */
export function serviceTotals(filters) {
  const { clause, params } = serviceFilters(filters);

  return queryOne(
    `SELECT COUNT(*)::int AS bookings,
            COUNT(*) FILTER (WHERE b.status = 'completed')::int AS completed,
            COUNT(*) FILTER (WHERE b.status = 'cancelled')::int AS cancelled,
            COUNT(*) FILTER (WHERE b.status = 'rejected')::int AS rejected,
            COUNT(DISTINCT b.provider_id)::int AS providers,
            COUNT(DISTINCT b.customer_id)::int AS customers,

            -- Collected: completed AND paid for. This is the only figure that
            -- matches the provider ledger and the payout queue.
            COUNT(*) FILTER (WHERE b.status = 'completed' AND ${COLLECTED})::int AS paid_count,
            COALESCE(SUM(b.final_amount_minor)
              FILTER (WHERE b.status = 'completed' AND ${COLLECTED}), 0)::bigint AS collected_minor,
            COALESCE(SUM(b.commission_amount_minor)
              FILTER (WHERE b.status = 'completed' AND ${COLLECTED}), 0)::bigint AS commission_minor,
            COALESCE(SUM(b.provider_earning_minor)
              FILTER (WHERE b.status = 'completed' AND ${COLLECTED}), 0)::bigint AS provider_earning_minor,

            -- Billed: everything delivered, paid or not. Real work, and a real
            -- receivable, so it is reported rather than hidden.
            COALESCE(SUM(b.final_amount_minor) FILTER (WHERE b.status = 'completed'), 0)::bigint AS billed_minor,
            COUNT(*) FILTER (WHERE b.status = 'completed' AND NOT ${COLLECTED})::int AS unpaid_count,
            COALESCE(SUM(b.final_amount_minor)
              FILTER (WHERE b.status = 'completed' AND NOT ${COLLECTED}), 0)::bigint AS awaiting_payment_minor,

            COALESCE(ROUND(AVG(b.final_amount_minor)
              FILTER (WHERE b.status = 'completed' AND ${COLLECTED})), 0)::bigint AS average_value_minor
       FROM bookings b
       ${clause}`,
    params,
  );
}

/** Per-service breakdown for the same filtered set, so a report has a summary worth reading. */
/**
 * Per-service totals, counting every service on a booking.
 *
 * Joining on `bookings.category_id` alone would credit a two-service booking
 * entirely to whichever service the customer happened to tick first, and show
 * the other as never booked. So the join is through `booking_items`, and the
 * money is split across them in proportion to what each service was quoted:
 * a 600-rupee job inside an 800-rupee visit carries three quarters of that
 * visit's revenue.
 *
 * `bookings` here therefore counts bookings *containing* the service, which
 * means the column sums to more than the number of bookings when customers
 * combine services. That is the honest reading of "how much work does this
 * service bring in"; the booking-level totals are reported separately.
 *
 * Rounding is per row, so apportioned revenue can differ from the booking
 * total by a few paise across a large set. Acceptable in a breakdown that
 * exists to rank services; the authoritative figures are the unapportioned
 * totals beside it.
 */
const ITEM_SHARE = `
  LEFT JOIN LATERAL (
    SELECT bi.category_id,
           bi.price_minor,
           SUM(bi.price_minor) OVER () AS booking_total,
           COUNT(*) OVER () AS item_count
      FROM booking_items bi
     WHERE bi.booking_id = b.id
  ) item ON TRUE
`;

/* A service's slice of its booking. Falls back to an equal split when every
   item on the booking was free, which would otherwise divide by zero. */
const SHARE = `
  CASE WHEN item.booking_total > 0
       THEN item.price_minor::numeric / item.booking_total
       ELSE 1.0 / GREATEST(item.item_count, 1)
  END
`;

export function serviceBreakdown(filters) {
  const { clause, params } = serviceFilters(filters);

  return queryMany(
    `SELECT c.name AS category_name,
            COUNT(*)::int AS bookings,
            COUNT(*) FILTER (WHERE b.status = 'completed')::int AS completed,
            COUNT(*) FILTER (WHERE b.status IN ('cancelled', 'rejected'))::int AS lost,
            COALESCE(SUM(ROUND(b.final_amount_minor * ${SHARE}))
              FILTER (WHERE b.status = 'completed' AND ${COLLECTED}), 0)::bigint AS collected_minor,
            COALESCE(SUM(ROUND(b.commission_amount_minor * ${SHARE}))
              FILTER (WHERE b.status = 'completed' AND ${COLLECTED}), 0)::bigint AS commission_minor,
            COALESCE(SUM(ROUND(b.final_amount_minor * ${SHARE}))
              FILTER (WHERE b.status = 'completed' AND NOT ${COLLECTED}), 0)::bigint AS awaiting_payment_minor
       FROM bookings b
       ${ITEM_SHARE}
       JOIN service_categories c ON c.id = item.category_id
       ${clause}
       GROUP BY c.name
       ORDER BY collected_minor DESC, bookings DESC`,
    params,
  );
}

function payoutFilters({ from, to, status, providerId, method }) {
  return buildFilters([
    ['po.created_at >= ?::timestamptz', from],
    ['po.created_at < ?::timestamptz', to],
    ['po.status = ?::payout_status', status],
    ['po.provider_id = ?', providerId],
    ['po.method = ?', method],
  ]);
}

/**
 * One row per payout, with the jobs it covered.
 *
 * jobs counts DISTINCT booking_id over the stamped earnings, so a payout that
 * bundled a job's fee and its commission as two ledger rows still reports one
 * job rather than two.
 */
export function payoutRows(filters, { limit, offset }) {
  const { clause, params } = payoutFilters(filters);

  return queryMany(
    `SELECT po.id, po.reference, po.status, po.method, po.amount_minor,
            po.payment_reference, po.destination, po.created_at, po.processed_at,
            po.failure_reason, po.notes,
            COALESCE(pp.business_name, pu.full_name) AS provider_name,
            pu.email AS provider_email,
            admin_user.full_name AS recorded_by,
            COALESCE(entries.jobs, 0)::int AS jobs
       FROM payouts po
       JOIN provider_profiles pp ON pp.id = po.provider_id
       JOIN users pu ON pu.id = pp.user_id
       LEFT JOIN users admin_user ON admin_user.id = po.paid_by
       LEFT JOIN LATERAL (
         SELECT COUNT(DISTINCT booking_id) AS jobs
           FROM provider_earnings
          WHERE payout_id = po.id AND booking_id IS NOT NULL
       ) entries ON TRUE
       ${clause}
       ORDER BY po.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
}

export function payoutTotals(filters) {
  const { clause, params } = payoutFilters(filters);

  return queryOne(
    `SELECT COUNT(*)::int AS payouts,
            COUNT(DISTINCT po.provider_id)::int AS providers,
            COALESCE(SUM(po.amount_minor), 0)::bigint AS total_minor,
            COALESCE(SUM(po.amount_minor) FILTER (WHERE po.status = 'paid'), 0)::bigint AS paid_minor,
            COALESCE(SUM(po.amount_minor) FILTER (WHERE po.status = 'pending'), 0)::bigint AS awaiting_minor,
            COALESCE(SUM(po.amount_minor) FILTER (WHERE po.status = 'failed'), 0)::bigint AS failed_minor,
            COUNT(*) FILTER (WHERE po.status = 'paid')::int AS paid_count,
            COUNT(*) FILTER (WHERE po.status = 'pending')::int AS awaiting_count,
            COUNT(*) FILTER (WHERE po.status = 'failed')::int AS failed_count
       FROM payouts po
       ${clause}`,
    params,
  );
}

/**
 * Money owed but not yet in any payout, per provider.
 *
 * This is the liability the platform is carrying, and it appears in no payout
 * row by definition - so a payouts report without it understates what is owed.
 */
export function outstandingLiability() {
  return queryMany(
    `SELECT COALESCE(pp.business_name, pu.full_name) AS provider_name,
            SUM(e.amount_minor)::bigint AS owed_minor,
            SUM(e.amount_minor) FILTER (WHERE e.available_at <= NOW())::bigint AS payable_now_minor,
            MIN(e.available_at) FILTER (WHERE e.available_at > NOW()) AS next_release,
            pp.payout_method IS NOT NULL AS has_destination
       FROM provider_earnings e
       JOIN provider_profiles pp ON pp.id = e.provider_id
       JOIN users pu ON pu.id = pp.user_id
      WHERE e.payout_id IS NULL AND pp.deleted_at IS NULL
      GROUP BY pp.id, pp.business_name, pu.full_name, pp.payout_method
     HAVING SUM(e.amount_minor) <> 0
      ORDER BY owed_minor DESC`,
  );
}

export default {
  serviceRows, serviceTotals, serviceBreakdown,
  payoutRows, payoutTotals, outstandingLiability,
};
