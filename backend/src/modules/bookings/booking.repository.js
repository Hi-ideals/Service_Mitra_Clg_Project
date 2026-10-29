/** Data access for the booking domain. */
import { query, queryOne, queryMany } from '../../db/pool.js';

const BOOKING = `
  b.id, b.reference, b.customer_id, b.provider_id, b.category_id, b.status,
  b.scheduled_start, b.scheduled_end, b.respond_by, b.description,
  b.customer_notes, b.address_line, b.address_city, b.address_state,
  b.address_pincode, b.address_lat, b.address_lng,
  b.quoted_amount_minor, b.visit_charge_minor, b.final_amount_minor,
  b.commission_percent, b.commission_amount_minor, b.provider_earning_minor,
  b.accepted_at, b.started_at, b.completed_at, b.cancelled_at, b.cancelled_by,
  b.cancellation_reason, b.rejection_reason, b.dispute_window_ends_at,
  b.completion_photos, b.created_at, b.updated_at
`;

/**
 * The booking's services, as a JSON array on the row.
 *
 * A lateral aggregate rather than a second round trip: every caller that
 * reads a booking needs its services, and fetching them separately would turn
 * one list query into N+1.
 */
const ITEMS = `
  COALESCE(items.list, '[]'::json) AS items
`;

const ITEMS_JOIN = `
  LEFT JOIN LATERAL (
    SELECT json_agg(
             json_build_object(
               'categoryId', ic.id,
               'name', ic.name,
               'slug', ic.slug,
               'icon', ic.icon,
               'priceMinor', bi.price_minor,
               'estimatedMinutes', bi.estimated_minutes,
               'commissionPercent', bi.commission_percent
             ) ORDER BY bi.position, ic.name
           ) AS list
      FROM booking_items bi
      JOIN service_categories ic ON ic.id = bi.category_id
     WHERE bi.booking_id = b.id
  ) items ON TRUE
`;

const JOINED = `
  c.name AS category_name, c.slug AS category_slug, c.icon AS category_icon,
  cu.full_name AS customer_name, cu.phone AS customer_phone,
  cu.email AS customer_email, cu.avatar_url AS customer_avatar,
  pu.full_name AS provider_name, pu.phone AS provider_phone, pu.avatar_url AS provider_avatar,
  p.business_name AS provider_business_name, p.rating_average AS provider_rating,
  p.user_id AS provider_user_id
`;

const FROM = `
  FROM bookings b
  JOIN service_categories c ON c.id = b.category_id
  JOIN users cu ON cu.id = b.customer_id
  JOIN provider_profiles p ON p.id = b.provider_id
  JOIN users pu ON pu.id = p.user_id
  ${ITEMS_JOIN}
`;

export function findById(id) {
  return queryOne(`SELECT ${BOOKING}, ${JOINED}, ${ITEMS} ${FROM} WHERE b.id = $1`, [id]);
}

export function findByReference(reference) {
  return queryOne(`SELECT ${BOOKING}, ${JOINED}, ${ITEMS} ${FROM} WHERE b.reference = $1`, [reference]);
}

/** Minimal read used by the transition guard - avoids loading joins to check a status. */
export function findForUpdate(tx, id) {
  return tx.one(
    `SELECT id, reference, customer_id, provider_id, status, scheduled_start,
            scheduled_end, quoted_amount_minor, visit_charge_minor,
            commission_percent, respond_by
       FROM bookings WHERE id = $1 FOR UPDATE`,
    [id],
  );
}

export function create(tx, d) {
  return tx.one(
    `INSERT INTO bookings
       (reference, customer_id, provider_id, category_id, scheduled_start, scheduled_end,
        respond_by, description, customer_notes, address_id, address_line, address_city,
        address_state, address_pincode, address_lat, address_lng,
        quoted_amount_minor, visit_charge_minor, commission_percent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING ${BOOKING.replaceAll('b.', '')}`,
    [
      d.reference, d.customerId, d.providerId, d.categoryId, d.scheduledStart, d.scheduledEnd,
      d.respondBy, d.description, d.customerNotes, d.addressId, d.addressLine, d.addressCity,
      d.addressState, d.addressPincode, d.addressLat, d.addressLng,
      d.quotedAmountMinor, d.visitChargeMinor, d.commissionPercent,
    ],
  );
}

/**
 * Writes the booking's services.
 *
 * One multi-row insert rather than a loop, so the unique constraint on
 * (booking_id, category_id) rejects a duplicated service as a single failed
 * statement instead of part-way through.
 */
export function createItems(tx, bookingId, items) {
  const values = [];
  const params = [];

  items.forEach((item, index) => {
    const at = index * 5;
    values.push('($' + (at + 1) + ',$' + (at + 2) + ',$' + (at + 3) + ',$' + (at + 4) + ',$' + (at + 5) + ')');
    params.push(bookingId, item.categoryId, item.priceMinor, item.estimatedMinutes, item.commissionPercent);
  });

  return tx.many(
    `INSERT INTO booking_items
       (booking_id, category_id, price_minor, estimated_minutes, commission_percent)
     VALUES ${values.join(',')}
     RETURNING id, category_id, price_minor, estimated_minutes, commission_percent`,
    params,
  );
}

/** The services on a booking, in display order. */
export function itemsFor(bookingId) {
  return queryMany(
    `SELECT bi.category_id, bi.price_minor, bi.estimated_minutes, bi.commission_percent,
            c.name AS category_name, c.slug AS category_slug
       FROM booking_items bi
       JOIN service_categories c ON c.id = bi.category_id
      WHERE bi.booking_id = $1
      ORDER BY bi.position, c.name`,
    [bookingId],
  );
}

/**
 * Applies a status change and its timestamps in one statement. The status
 * column is only ever written here, and only from the service layer's guard.
 */
export function applyTransition(tx, id, { status, patch = {} }) {
  return tx.one(
    `UPDATE bookings SET
       status = $2,
       accepted_at = COALESCE($3, accepted_at),
       started_at = COALESCE($4, started_at),
       completed_at = COALESCE($5, completed_at),
       cancelled_at = COALESCE($6, cancelled_at),
       cancelled_by = COALESCE($7, cancelled_by),
       cancellation_reason = COALESCE($8, cancellation_reason),
       rejection_reason = COALESCE($9, rejection_reason),
       final_amount_minor = COALESCE($10, final_amount_minor),
       commission_amount_minor = COALESCE($11, commission_amount_minor),
       provider_earning_minor = COALESCE($12, provider_earning_minor),
       dispute_window_ends_at = COALESCE($13, dispute_window_ends_at),
       completion_otp_hash = COALESCE($14, completion_otp_hash)
     WHERE id = $1
     RETURNING ${BOOKING.replaceAll('b.', '')}`,
    [
      id, status, patch.acceptedAt ?? null, patch.startedAt ?? null, patch.completedAt ?? null,
      patch.cancelledAt ?? null, patch.cancelledBy ?? null, patch.cancellationReason ?? null,
      patch.rejectionReason ?? null, patch.finalAmountMinor ?? null,
      patch.commissionAmountMinor ?? null, patch.providerEarningMinor ?? null,
      patch.disputeWindowEndsAt ?? null, patch.completionOtpHash ?? null,
    ],
  );
}

export function reschedule(tx, id, { start, end, respondBy }) {
  return tx.one(
    `UPDATE bookings SET scheduled_start = $2, scheduled_end = $3,
            respond_by = COALESCE($4, respond_by)
      WHERE id = $1
      RETURNING ${BOOKING.replaceAll('b.', '')}`,
    [id, start, end, respondBy ?? null],
  );
}

export function recordHistory(tx, { bookingId, fromStatus, toStatus, actorType, actorId, reason, metadata }) {
  return tx.query(
    `INSERT INTO booking_status_history
       (booking_id, from_status, to_status, actor_type, actor_id, reason, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [bookingId, fromStatus, toStatus, actorType, actorId ?? null, reason ?? null,
     metadata ? JSON.stringify(metadata) : null],
  );
}

export function history(bookingId) {
  return queryMany(
    `SELECT h.from_status, h.to_status, h.actor_type, h.reason, h.created_at,
            u.full_name AS actor_name
       FROM booking_status_history h
       LEFT JOIN users u ON u.id = h.actor_id
      WHERE h.booking_id = $1
      ORDER BY h.created_at`,
    [bookingId],
  );
}

export default {
  findById, findByReference, findForUpdate, create, applyTransition,
  reschedule, recordHistory, history,
};

// ---------- listings ----------

/**
 * One list query serving all three roles. The scope is decided by the caller's
 * identity, never by a parameter from the request, so a customer cannot ask
 * for somebody else's bookings by changing a query string.
 */
export async function list({ customerId, providerId, status, from, to, search, limit, offset }) {
  const where = [];
  const params = [];
  const push = (v) => {
    params.push(v);
    return '$' + params.length;
  };

  if (customerId) where.push(`b.customer_id = ${push(customerId)}`);
  if (providerId) where.push(`b.provider_id = ${push(providerId)}`);

  if (status?.length) where.push(`b.status = ANY(${push(status)}::booking_status[])`);
  if (from) where.push(`b.scheduled_start >= ${push(from)}::timestamptz`);
  if (to) where.push(`b.scheduled_start < ${push(to)}::timestamptz`);

  if (search) {
    const p = push('%' + search + '%');
    where.push(`(b.reference ILIKE ${p} OR c.name ILIKE ${p} OR cu.full_name ILIKE ${p} OR pu.full_name ILIKE ${p})`);
  }

  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const totalRow = await queryOne(`SELECT COUNT(*)::int AS total ${FROM} ${clause}`, params);

  params.push(limit, offset);
  const items = await queryMany(
    `SELECT ${BOOKING}, ${JOINED}, ${ITEMS} ${FROM} ${clause}
      ORDER BY b.scheduled_start DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { items, total: totalRow.total };
}

/** Counts per status, for the tabs above a booking list. */
export function statusCounts({ customerId, providerId }) {
  return queryOne(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'requested')::int   AS requested,
       COUNT(*) FILTER (WHERE status = 'accepted')::int    AS accepted,
       COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
       COUNT(*) FILTER (WHERE status = 'completed')::int   AS completed,
       COUNT(*) FILTER (WHERE status = 'cancelled')::int   AS cancelled,
       COUNT(*) FILTER (WHERE status = 'rejected')::int    AS rejected,
       COUNT(*)::int AS total
     FROM bookings
     WHERE ($1::uuid IS NULL OR customer_id = $1)
       AND ($2::uuid IS NULL OR provider_id = $2)`,
    [customerId ?? null, providerId ?? null],
  );
}

// ---------- slot validation ----------

/** The provider's offering for this category, with the category's own rules. */
/**
 * Every requested service, in one query.
 *
 * Returns only the rows that exist, so the caller compares the count against
 * what was asked for and can name the service the provider does not offer -
 * better than a flat "one of these is unavailable".
 */
export function serviceOfferings(providerId, categoryIds) {
  return queryMany(
    `SELECT pc.category_id, pc.price_minor, pc.visit_charge_minor, pc.pricing_unit, pc.is_active,
            c.name AS category_name, c.estimated_minutes, c.commission_percent,
            c.is_active AS category_active,
            p.verification_status, p.is_accepting_bookings, p.slot_buffer_minutes,
            p.user_id AS provider_user_id, p.deleted_at
       FROM provider_categories pc
       JOIN service_categories c ON c.id = pc.category_id
       JOIN provider_profiles p ON p.id = pc.provider_id
      WHERE pc.provider_id = $1 AND pc.category_id = ANY($2::uuid[])`,
    [providerId, categoryIds],
  );
}

export function serviceOffering(providerId, categoryId) {
  return queryOne(
    `SELECT pc.price_minor, pc.visit_charge_minor, pc.pricing_unit, pc.is_active,
            c.name AS category_name, c.estimated_minutes, c.commission_percent,
            c.is_active AS category_active,
            p.verification_status, p.is_accepting_bookings, p.slot_buffer_minutes,
            p.user_id AS provider_user_id, p.deleted_at
       FROM provider_categories pc
       JOIN service_categories c ON c.id = pc.category_id
       JOIN provider_profiles p ON p.id = pc.provider_id
      WHERE pc.provider_id = $1 AND pc.category_id = $2`,
    [providerId, categoryId],
  );
}

/** Does the requested window fall inside a published working window? */
export function coveringWindow(providerId, dayOfWeek, startTime, endTime) {
  return queryOne(
    `SELECT id FROM provider_availability
      WHERE provider_id = $1 AND day_of_week = $2 AND is_active
        AND start_time <= $3::time AND end_time >= $4::time
      LIMIT 1`,
    [providerId, dayOfWeek, startTime, endTime],
  );
}

export function exceptionForDate(providerId, date) {
  return queryOne(
    `SELECT is_available, start_time, end_time, reason
       FROM availability_exceptions
      WHERE provider_id = $1 AND exception_date = $2::date`,
    [providerId, date],
  );
}

/** Does the provider actually cover this address? */
export function coversLocation(providerId, pincode, city) {
  return queryOne(
    `SELECT id FROM provider_service_areas
      WHERE provider_id = $1 AND is_active
        AND ($2 = ANY(pincodes) OR city ILIKE $3)
      LIMIT 1`,
    [providerId, pincode, city],
  );
}

export function customerAddress(customerId, addressId) {
  return queryOne(
    `SELECT id, line1, line2, city, state, pincode, latitude, longitude
       FROM addresses WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [addressId, customerId],
  );
}

/** Requests the provider has left unanswered past the deadline. */
export function expiredRequests(limit = 100) {
  return queryMany(
    `SELECT id, reference, customer_id, provider_id
       FROM bookings
      WHERE status = 'requested' AND respond_by IS NOT NULL AND respond_by < NOW()
      ORDER BY respond_by
      LIMIT $1`,
    [limit],
  );
}

/** Keeps the provider's acceptance rate honest after every decision. */
export function refreshAcceptanceRate(tx, providerId) {
  return tx.query(
    `UPDATE provider_profiles p SET acceptance_rate = COALESCE((
        SELECT ROUND(
                 100.0 * COUNT(*) FILTER (WHERE b.status <> 'rejected')
                 / NULLIF(COUNT(*), 0), 2)
          FROM bookings b
         WHERE b.provider_id = p.id
           AND b.status IN ('accepted','in_progress','completed','rejected','cancelled')
      ), 0)
      WHERE p.id = $1`,
    [providerId],
  );
}
