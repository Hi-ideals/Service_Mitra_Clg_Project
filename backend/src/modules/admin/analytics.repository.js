/**
 * Analytics queries.
 *
 * Every query here is an aggregate over history rather than a row fetch, which
 * is why the architecture puts them on the read replica: an admin running a
 * year-long revenue report must never slow down a customer trying to book a
 * plumber. The pool is pointed at the primary today; switching these to a
 * replica is a connection-string change, not a rewrite.
 */
import { queryOne, queryMany } from '../../db/pool.js';
import { COLLECTED } from '../../utils/revenue.js';

/** Headline numbers for the dashboard tiles. */
export function overview({ from, to }) {
  return queryOne(
    `SELECT
       COUNT(*)::int AS total_bookings,
       COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
       COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
       COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
       COUNT(*) FILTER (WHERE status IN ('requested','accepted','in_progress'))::int AS live,
       COUNT(DISTINCT customer_id)::int AS active_customers,
       COUNT(DISTINCT provider_id)::int AS active_providers,
       -- Revenue is money received, not work finished. Completing a job does
       -- not credit the provider either; only a settled payment does. Counting
       -- completion here made the dashboard disagree with every other screen.
       COALESCE(SUM(final_amount_minor)
         FILTER (WHERE status = 'completed' AND ${COLLECTED}), 0)::bigint AS gross_revenue,
       COALESCE(SUM(commission_amount_minor)
         FILTER (WHERE status = 'completed' AND ${COLLECTED}), 0)::bigint AS commission,
       -- Delivered but not yet paid for. A receivable, reported rather than
       -- folded into revenue or dropped entirely.
       COALESCE(SUM(final_amount_minor)
         FILTER (WHERE status = 'completed' AND NOT ${COLLECTED}), 0)::bigint AS awaiting_payment,
       COUNT(*) FILTER (WHERE status = 'completed' AND NOT ${COLLECTED})::int AS awaiting_payment_count,
       COALESCE(ROUND(AVG(final_amount_minor)
         FILTER (WHERE status = 'completed' AND ${COLLECTED})), 0)::bigint AS average_order_value
     FROM bookings b
     WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz`,
    [from, to],
  );
}

/** Platform totals that are not time-bounded. */
export function platformTotals() {
  return queryOne(
    `SELECT
       (SELECT COUNT(*)::int FROM users WHERE role = 'customer' AND deleted_at IS NULL) AS customers,
       (SELECT COUNT(*)::int FROM provider_profiles WHERE deleted_at IS NULL) AS providers,
       (SELECT COUNT(*)::int FROM provider_profiles
         WHERE verification_status = 'approved' AND deleted_at IS NULL) AS verified_providers,
       (SELECT COUNT(*)::int FROM provider_profiles
         WHERE verification_status = 'approved' AND is_accepting_bookings AND deleted_at IS NULL) AS live_providers,
       (SELECT COUNT(*)::int FROM kyc_submissions WHERE status = 'pending') AS pending_kyc,
       (SELECT COUNT(*)::int FROM disputes WHERE resolved_at IS NULL) AS open_disputes,
       (SELECT COUNT(*)::int FROM reviews WHERE status = 'flagged') AS flagged_reviews,
       (SELECT COUNT(*)::int FROM service_categories WHERE is_active AND deleted_at IS NULL) AS active_categories`,
  );
}

/**
 * A time series of bookings and revenue.
 *
 * generate_series fills the gaps, so a day with no bookings appears as a zero
 * rather than being missing - a chart with holes in it reads as broken.
 */
export function timeSeries({ from, to, granularity }) {
  const truncation = { day: 'day', week: 'week', month: 'month' }[granularity] ?? 'day';

  return queryMany(
    `WITH periods AS (
       SELECT generate_series(
         date_trunc($3, $1::timestamptz),
         date_trunc($3, $2::timestamptz),
         ('1 ' || $3)::interval
       ) AS period
     )
     SELECT p.period,
            COUNT(b.id)::int AS bookings,
            COUNT(b.id) FILTER (WHERE b.status = 'completed')::int AS completed,
            COUNT(b.id) FILTER (WHERE b.status = 'cancelled')::int AS cancelled,
            COALESCE(SUM(b.final_amount_minor)
              FILTER (WHERE b.status = 'completed' AND ${COLLECTED}), 0)::bigint AS revenue,
            COALESCE(SUM(b.commission_amount_minor)
              FILTER (WHERE b.status = 'completed' AND ${COLLECTED}), 0)::bigint AS commission
       FROM periods p
       LEFT JOIN bookings b
         ON date_trunc($3, b.created_at) = p.period
        AND b.created_at >= $1::timestamptz AND b.created_at < $2::timestamptz
      GROUP BY p.period
      ORDER BY p.period`,
    [from, to, truncation],
  );
}

export function topCategories({ from, to, limit }) {
  return queryMany(
    /* Joined through booking_items so a service booked alongside another is
       still counted, with each one credited its share of the visit. See the
       note on serviceBreakdown in reports.repository.js. */
    `SELECT c.id, c.name, c.slug,
            COUNT(b.id)::int AS bookings,
            COUNT(b.id) FILTER (WHERE b.status = 'completed')::int AS completed,
            COALESCE(SUM(ROUND(b.final_amount_minor * (
              CASE WHEN item.booking_total > 0
                   THEN item.price_minor::numeric / item.booking_total
                   ELSE 1.0 / GREATEST(item.item_count, 1) END)))
              FILTER (WHERE b.status = 'completed' AND ${COLLECTED}), 0)::bigint AS revenue,
            COALESCE(ROUND(AVG(b.final_amount_minor * (
              CASE WHEN item.booking_total > 0
                   THEN item.price_minor::numeric / item.booking_total
                   ELSE 1.0 / GREATEST(item.item_count, 1) END))
              FILTER (WHERE b.status = 'completed' AND ${COLLECTED})), 0)::bigint AS average_value
       FROM bookings b
       LEFT JOIN LATERAL (
         SELECT bi.category_id,
                bi.price_minor,
                SUM(bi.price_minor) OVER () AS booking_total,
                COUNT(*) OVER () AS item_count
           FROM booking_items bi
          WHERE bi.booking_id = b.id
       ) item ON TRUE
       JOIN service_categories c ON c.id = item.category_id
      WHERE b.created_at >= $1::timestamptz AND b.created_at < $2::timestamptz
      GROUP BY c.id
      ORDER BY bookings DESC, revenue DESC
      LIMIT $3`,
    [from, to, limit],
  );
}

export function topLocations({ from, to, limit }) {
  return queryMany(
    `SELECT address_city AS city, address_state AS state,
            COUNT(*)::int AS bookings,
            COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
            COALESCE(SUM(final_amount_minor)
              FILTER (WHERE status = 'completed' AND ${COLLECTED}), 0)::bigint AS revenue
       FROM bookings b
      WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
      GROUP BY address_city, address_state
      ORDER BY bookings DESC
      LIMIT $3`,
    [from, to, limit],
  );
}

/** Provider leaderboard - the ops view of who is actually carrying the platform. */
export function providerPerformance({ from, to, limit, sort }) {
  const order = {
    revenue: 'revenue DESC',
    bookings: 'bookings DESC',
    rating: 'p.rating_average DESC, p.rating_count DESC',
    completion: 'completion_rate DESC',
  }[sort] ?? 'revenue DESC';

  return queryMany(
    `SELECT p.id, COALESCE(p.business_name, u.full_name) AS name,
            p.rating_average, p.rating_count, p.acceptance_rate,
            COUNT(b.id)::int AS bookings,
            COUNT(b.id) FILTER (WHERE b.status = 'completed')::int AS completed,
            COUNT(b.id) FILTER (WHERE b.status = 'cancelled')::int AS cancelled,
            COALESCE(SUM(b.final_amount_minor)
              FILTER (WHERE b.status = 'completed' AND ${COLLECTED}), 0)::bigint AS revenue,
            COALESCE(SUM(b.commission_amount_minor)
              FILTER (WHERE b.status = 'completed' AND ${COLLECTED}), 0)::bigint AS commission,
            CASE WHEN COUNT(b.id) = 0 THEN 0
                 ELSE ROUND(100.0 * COUNT(b.id) FILTER (WHERE b.status = 'completed') / COUNT(b.id), 1)
            END AS completion_rate
       FROM provider_profiles p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN bookings b ON b.provider_id = p.id
        AND b.created_at >= $1::timestamptz AND b.created_at < $2::timestamptz
      WHERE p.deleted_at IS NULL
      GROUP BY p.id, u.full_name
      HAVING COUNT(b.id) > 0
      ORDER BY ${order}
      LIMIT $3`,
    [from, to, limit],
  );
}

/** Where bookings fall out of the funnel, which is where ops should look first. */
export function funnel({ from, to }) {
  return queryOne(
    `SELECT
       COUNT(*)::int AS requested,
       COUNT(*) FILTER (WHERE accepted_at IS NOT NULL)::int AS accepted,
       COUNT(*) FILTER (WHERE started_at IS NOT NULL)::int AS started,
       COUNT(*) FILTER (WHERE completed_at IS NOT NULL)::int AS completed,
       COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
       COUNT(*) FILTER (WHERE status = 'cancelled' AND cancelled_by = 'customer')::int AS cancelled_by_customer,
       COUNT(*) FILTER (WHERE status = 'cancelled' AND cancelled_by = 'provider')::int AS cancelled_by_provider,
       COUNT(*) FILTER (WHERE status = 'cancelled' AND cancelled_by = 'system')::int AS expired,
       COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (accepted_at - created_at)) / 60)
                FILTER (WHERE accepted_at IS NOT NULL)), 0)::int AS avg_response_minutes
     FROM bookings
     WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz`,
    [from, to],
  );
}

/**
 * Repeat-customer rate. A marketplace that cannot get a second booking out of
 * a customer is buying growth rather than earning it, so this is the retention
 * number worth putting on the dashboard.
 */
export function retention({ from, to }) {
  return queryOne(
    `WITH per_customer AS (
       SELECT customer_id, COUNT(*)::int AS bookings
         FROM bookings
        WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
        GROUP BY customer_id
     )
     SELECT
       COUNT(*)::int AS customers,
       COUNT(*) FILTER (WHERE bookings > 1)::int AS repeat_customers,
       CASE WHEN COUNT(*) = 0 THEN 0
            ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE bookings > 1) / COUNT(*), 1)
       END AS repeat_rate,
       COALESCE(ROUND(AVG(bookings), 2), 0) AS bookings_per_customer
     FROM per_customer`,
    [from, to],
  );
}

/** Payment health - the number that tells you the gateway integration is fine. */
export function paymentHealth({ from, to }) {
  return queryOne(
    `SELECT
       COUNT(*)::int AS attempts,
       COUNT(*) FILTER (WHERE status = 'paid')::int AS succeeded,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
       COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
       COUNT(*) FILTER (WHERE status IN ('refunded','partially_refunded'))::int AS refunded,
       CASE WHEN COUNT(*) FILTER (WHERE status IN ('paid','failed')) = 0 THEN 0
            ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'paid')
                 / COUNT(*) FILTER (WHERE status IN ('paid','failed')), 1)
       END AS success_rate,
       COALESCE((SELECT SUM(amount_minor) FROM refunds r
                  WHERE r.status = 'completed'
                    AND r.created_at >= $1::timestamptz AND r.created_at < $2::timestamptz), 0)::bigint AS refunded_amount
     FROM payments
     WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz`,
    [from, to],
  );
}

export default {
  overview, platformTotals, timeSeries, topCategories, topLocations,
  providerPerformance, funnel, retention, paymentHealth,
};
