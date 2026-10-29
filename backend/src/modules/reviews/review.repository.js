/** Data access for the reputation domain. */
import { query, queryOne, queryMany } from '../../db/pool.js';

const REVIEW = `
  r.id, r.booking_id, r.customer_id, r.provider_id, r.rating, r.title, r.comment,
  r.punctuality_rating, r.quality_rating, r.behaviour_rating, r.photos,
  r.provider_reply, r.provider_replied_at, r.status, r.moderation_reason,
  r.report_count, r.created_at, r.updated_at
`;

export function findById(id) {
  return queryOne(`SELECT ${REVIEW} FROM reviews r WHERE r.id = $1`, [id]);
}

export function findByBooking(bookingId) {
  return queryOne(`SELECT ${REVIEW} FROM reviews r WHERE r.booking_id = $1`, [bookingId]);
}

/**
 * The booking a review would attach to, with everything eligibility depends on.
 * Returns null when the booking does not exist at all.
 */
export function bookingForReview(bookingId) {
  return queryOne(
    `SELECT b.id, b.customer_id, b.provider_id, b.status, b.completed_at,
            c.name AS category_name, p.user_id AS provider_user_id
       FROM bookings b
       JOIN service_categories c ON c.id = b.category_id
       JOIN provider_profiles p ON p.id = b.provider_id
      WHERE b.id = $1`,
    [bookingId],
  );
}

export function create(tx, d) {
  return tx.one(
    `INSERT INTO reviews
       (booking_id, customer_id, provider_id, rating, title, comment,
        punctuality_rating, quality_rating, behaviour_rating, photos)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING ${REVIEW.replaceAll('r.', '')}`,
    [d.bookingId, d.customerId, d.providerId, d.rating, d.title, d.comment,
     d.punctualityRating, d.qualityRating, d.behaviourRating, d.photos],
  );
}

export function addReply(id, providerId, reply) {
  return queryOne(
    `UPDATE reviews SET provider_reply = $3, provider_replied_at = NOW()
      WHERE id = $1 AND provider_id = $2
      RETURNING ${REVIEW.replaceAll('r.', '')}`,
    [id, providerId, reply],
  );
}

export function moderate(tx, id, { status, adminId, reason }) {
  return tx.one(
    `UPDATE reviews SET status = $2, moderated_by = $3, moderated_at = NOW(), moderation_reason = $4
      WHERE id = $1
      RETURNING ${REVIEW.replaceAll('r.', '')}`,
    [id, status, adminId, reason ?? null],
  );
}

export function report(reviewId, userId, { reason, details }) {
  return queryOne(
    `INSERT INTO review_reports (review_id, reported_by, reason, details)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (review_id, reported_by) DO NOTHING
     RETURNING id`,
    [reviewId, userId, reason, details ?? null],
  );
}

/**
 * Bumps the report counter and auto-flags once enough independent people have
 * complained. Flagging hides nothing on its own - it only raises the review
 * into the admin queue for a human decision.
 */
export function bumpReportCount(reviewId, flagThreshold) {
  return queryOne(
    `UPDATE reviews
        SET report_count = report_count + 1,
            status = CASE
                       WHEN status = 'published' AND report_count + 1 >= $2 THEN 'flagged'
                       ELSE status
                     END
      WHERE id = $1
      RETURNING id, report_count, status`,
    [reviewId, flagThreshold],
  );
}

export default {
  findById, findByBooking, bookingForReview, create, addReply, moderate, report, bumpReportCount,
};

// ---------- listings ----------

/** Public reviews on a provider profile. Only published reviews are ever returned. */
export async function listForProvider(providerId, { rating, withPhotos, limit, offset }) {
  const where = ["r.status = 'published'", 'r.provider_id = $1'];
  const params = [providerId];
  const push = (v) => {
    params.push(v);
    return '$' + params.length;
  };

  if (rating) where.push(`r.rating = ${push(rating)}`);
  if (withPhotos) where.push('array_length(r.photos, 1) > 0');

  const clause = 'WHERE ' + where.join(' AND ');

  const totalRow = await queryOne(`SELECT COUNT(*)::int AS total FROM reviews r ${clause}`, params);

  params.push(limit, offset);
  const items = await queryMany(
    // The reference tells a provider which visit is being talked about, which
    // is the first thing they want to know. The booking itself stays readable
    // only to the people on it, so the code on its own opens nothing.
    `SELECT ${REVIEW}, u.full_name AS customer_name, u.avatar_url AS customer_avatar,
            c.name AS category_name, b.reference AS booking_reference
       FROM reviews r
       JOIN users u ON u.id = r.customer_id
       JOIN bookings b ON b.id = r.booking_id
       JOIN service_categories c ON c.id = b.category_id
       ${clause}
       ORDER BY r.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { items, total: totalRow.total };
}

/** The star-distribution bar chart on a provider profile. */
export function ratingBreakdown(providerId) {
  return queryOne(
    `SELECT
       COUNT(*) FILTER (WHERE rating = 5)::int AS five,
       COUNT(*) FILTER (WHERE rating = 4)::int AS four,
       COUNT(*) FILTER (WHERE rating = 3)::int AS three,
       COUNT(*) FILTER (WHERE rating = 2)::int AS two,
       COUNT(*) FILTER (WHERE rating = 1)::int AS one,
       COUNT(*)::int AS total,
       COALESCE(ROUND(AVG(rating)::numeric, 2), 0) AS average,
       COALESCE(ROUND(AVG(punctuality_rating)::numeric, 2), 0) AS punctuality,
       COALESCE(ROUND(AVG(quality_rating)::numeric, 2), 0) AS quality,
       COALESCE(ROUND(AVG(behaviour_rating)::numeric, 2), 0) AS behaviour
     FROM reviews
     WHERE provider_id = $1 AND status = 'published'`,
    [providerId],
  );
}

export async function listForCustomer(customerId, { limit, offset }) {
  const totalRow = await queryOne(
    'SELECT COUNT(*)::int AS total FROM reviews WHERE customer_id = $1',
    [customerId],
  );

  const items = await queryMany(
    `SELECT ${REVIEW}, c.name AS category_name, b.reference AS booking_reference,
            pp.business_name AS provider_business_name, pu.full_name AS provider_name
       FROM reviews r
       JOIN bookings b ON b.id = r.booking_id
       JOIN service_categories c ON c.id = b.category_id
       JOIN provider_profiles pp ON pp.id = r.provider_id
       JOIN users pu ON pu.id = pp.user_id
      WHERE r.customer_id = $1
      ORDER BY r.created_at DESC
      LIMIT $2 OFFSET $3`,
    [customerId, limit, offset],
  );

  return { items, total: totalRow.total };
}

/** Completed bookings the customer has not reviewed yet. */
export function awaitingReview(customerId, limit) {
  return queryMany(
    `SELECT b.id, b.reference, b.completed_at, c.name AS category_name,
            pp.id AS provider_id, pp.business_name, pu.full_name AS provider_name
       FROM bookings b
       JOIN service_categories c ON c.id = b.category_id
       JOIN provider_profiles pp ON pp.id = b.provider_id
       JOIN users pu ON pu.id = pp.user_id
       LEFT JOIN reviews r ON r.booking_id = b.id
      WHERE b.customer_id = $1 AND b.status = 'completed' AND r.id IS NULL
      ORDER BY b.completed_at DESC
      LIMIT $2`,
    [customerId, limit],
  );
}

/** The admin moderation queue: flagged or already hidden reviews. */
export async function moderationQueue({ status, limit, offset }) {
  const clause = status
    ? 'WHERE r.status = $1'
    : "WHERE r.status IN ('flagged','hidden')";
  const params = status ? [status] : [];

  const totalRow = await queryOne(`SELECT COUNT(*)::int AS total FROM reviews r ${clause}`, params);

  params.push(limit, offset);
  const items = await queryMany(
    `SELECT ${REVIEW}, u.full_name AS customer_name,
            pp.business_name AS provider_business_name, pu.full_name AS provider_name,
            (SELECT json_agg(json_build_object('reason', rr.reason, 'details', rr.details,
                                               'at', rr.created_at))
               FROM review_reports rr WHERE rr.review_id = r.id) AS reports
       FROM reviews r
       JOIN users u ON u.id = r.customer_id
       JOIN provider_profiles pp ON pp.id = r.provider_id
       JOIN users pu ON pu.id = pp.user_id
       ${clause}
       ORDER BY r.report_count DESC, r.created_at
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { items, total: totalRow.total };
}

/**
 * Recomputes a provider's denormalised rating from their published reviews.
 *
 * Always a full recompute rather than an incremental nudge: moderation can
 * remove a review after the fact, and an incremental counter would drift away
 * from the truth with no way to notice.
 */
export function refreshProviderRating(tx, providerId) {
  return tx.one(
    `UPDATE provider_profiles p
        SET rating_average = COALESCE((
              SELECT ROUND(AVG(rating)::numeric, 2) FROM reviews
               WHERE provider_id = p.id AND status = 'published'
            ), 0),
            rating_count = (
              SELECT COUNT(*) FROM reviews
               WHERE provider_id = p.id AND status = 'published'
            )
      WHERE p.id = $1
      RETURNING p.id, p.rating_average, p.rating_count`,
    [providerId],
  );
}
