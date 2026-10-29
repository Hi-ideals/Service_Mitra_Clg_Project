/** Data access for the dispute domain. */
import { queryOne, queryMany } from '../../db/pool.js';

const DISPUTE = `
  d.id, d.reference, d.booking_id, d.raised_by, d.raised_by_type, d.category,
  d.subject, d.description, d.evidence, d.status, d.priority, d.assigned_to,
  d.resolution, d.resolution_type, d.refund_amount_minor, d.resolved_by,
  d.resolved_at, d.created_at, d.updated_at
`;

export function findById(id) {
  return queryOne(
    `SELECT ${DISPUTE},
            b.reference AS booking_reference, b.status AS booking_status,
            b.final_amount_minor, b.completed_at, b.dispute_window_ends_at,
            b.customer_id, b.provider_id,
            c.name AS category_name,
            cu.full_name AS customer_name, cu.phone AS customer_phone,
            pp.business_name AS provider_business_name,
            pu.full_name AS provider_name, pp.user_id AS provider_user_id,
            au.full_name AS assigned_to_name
       FROM disputes d
       JOIN bookings b ON b.id = d.booking_id
       JOIN service_categories c ON c.id = b.category_id
       JOIN users cu ON cu.id = b.customer_id
       JOIN provider_profiles pp ON pp.id = b.provider_id
       JOIN users pu ON pu.id = pp.user_id
       LEFT JOIN users au ON au.id = d.assigned_to
      WHERE d.id = $1`,
    [id],
  );
}

export function findOpenForBooking(bookingId) {
  return queryOne(
    `SELECT ${DISPUTE} FROM disputes d
      WHERE d.booking_id = $1 AND d.status NOT IN ('resolved','rejected')
      ORDER BY d.created_at DESC LIMIT 1`,
    [bookingId],
  );
}

export function create(tx, d) {
  return tx.one(
    `INSERT INTO disputes
       (reference, booking_id, raised_by, raised_by_type, category, subject,
        description, evidence, priority)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING ${DISPUTE.replaceAll('d.', '')}`,
    [d.reference, d.bookingId, d.raisedBy, d.raisedByType, d.category, d.subject,
     d.description, d.evidence, d.priority],
  );
}

export function resolve(tx, id, d) {
  return tx.one(
    `UPDATE disputes
        SET status = $2, resolution = $3, resolution_type = $4,
            refund_amount_minor = $5, resolved_by = $6, resolved_at = NOW()
      WHERE id = $1
      RETURNING ${DISPUTE.replaceAll('d.', '')}`,
    [id, d.status, d.resolution, d.resolutionType, d.refundAmountMinor ?? null, d.resolvedBy],
  );
}

export function assign(id, adminId) {
  return queryOne(
    `UPDATE disputes SET assigned_to = $2,
            status = CASE WHEN status = 'open' THEN 'under_review' ELSE status END
      WHERE id = $1
      RETURNING ${DISPUTE.replaceAll('d.', '')}`,
    [id, adminId],
  );
}

export function addMessage(disputeId, { authorId, authorType, message, attachments, isInternal }) {
  return queryOne(
    `INSERT INTO dispute_messages (dispute_id, author_id, author_type, message, attachments, is_internal)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, author_type, message, attachments, is_internal, created_at`,
    [disputeId, authorId, authorType, message, attachments ?? [], isInternal ?? false],
  );
}

/** Internal notes are excluded unless the reader is an admin. */
export function messages(disputeId, { includeInternal }) {
  return queryMany(
    `SELECT m.id, m.author_type, m.message, m.attachments, m.is_internal, m.created_at,
            u.full_name AS author_name
       FROM dispute_messages m
       LEFT JOIN users u ON u.id = m.author_id
      WHERE m.dispute_id = $1 AND ($2::boolean OR m.is_internal = FALSE)
      ORDER BY m.created_at`,
    [disputeId, includeInternal],
  );
}

export async function list({ status, priority, assignedTo, bookingId, raisedBy, partyCustomerId, partyProviderId, limit, offset }) {
  const where = [];
  const params = [];
  const push = (v) => {
    params.push(v);
    return '$' + params.length;
  };

  if (status) where.push(`d.status = ${push(status)}`);
  if (priority) where.push(`d.priority = ${push(priority)}`);
  if (assignedTo) where.push(`d.assigned_to = ${push(assignedTo)}`);
  if (bookingId) where.push(`d.booking_id = ${push(bookingId)}`);
  if (raisedBy) where.push(`d.raised_by = ${push(raisedBy)}`);
  // Being a party is not the same as having raised it: the side a dispute is
  // *against* still has to be able to find it, and their payout is the thing
  // being held.
  if (partyCustomerId) where.push(`b.customer_id = ${push(partyCustomerId)}`);
  if (partyProviderId) where.push(`b.provider_id = ${push(partyProviderId)}`);

  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const totalRow = await queryOne(
    `SELECT COUNT(*)::int AS total FROM disputes d
       JOIN bookings b ON b.id = d.booking_id
     ${clause}`,
    params,
  );

  params.push(limit, offset);
  const items = await queryMany(
    `SELECT ${DISPUTE}, b.reference AS booking_reference, b.final_amount_minor,
            c.name AS category_name, cu.full_name AS customer_name,
            COALESCE(pp.business_name, pu.full_name) AS provider_name
       FROM disputes d
       JOIN bookings b ON b.id = d.booking_id
       JOIN service_categories c ON c.id = b.category_id
       JOIN users cu ON cu.id = b.customer_id
       JOIN provider_profiles pp ON pp.id = b.provider_id
       JOIN users pu ON pu.id = pp.user_id
       ${clause}
       ORDER BY
         CASE d.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
         d.created_at
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { items, total: totalRow.total };
}

export function counts() {
  return queryOne(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'open')::int AS open,
       COUNT(*) FILTER (WHERE status = 'under_review')::int AS under_review,
       COUNT(*) FILTER (WHERE status = 'awaiting_response')::int AS awaiting_response,
       COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved,
       COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
       COUNT(*) FILTER (WHERE resolved_at IS NULL AND created_at < NOW() - INTERVAL '72 hours')::int AS overdue
     FROM disputes`,
  );
}

export default {
  findById, findOpenForBooking, create, resolve, assign, addMessage, messages, list, counts,
};
