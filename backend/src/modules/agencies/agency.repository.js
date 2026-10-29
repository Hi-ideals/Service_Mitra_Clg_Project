/**
 * Agency queries.
 *
 * Every statement that touches a provider takes the agency id as a parameter
 * and filters on it in SQL. None of them accept a provider id alone, because
 * an ownership check that lives only in the service layer is one forgotten
 * call away from letting one agency read another's people.
 */
import { query, queryOne, queryMany } from '../../db/pool.js';

const AGENCY = `
  a.id, a.user_id, a.name, a.headline, a.about, a.registration_no,
  a.address_line, a.city, a.state, a.pincode,
  a.verification_status, a.verified_at, a.created_at
`;

export function findByUserId(userId) {
  return queryOne(
    `SELECT ${AGENCY}, u.full_name AS contact_name, u.email, u.phone
       FROM agencies a
       JOIN users u ON u.id = a.user_id
      WHERE a.user_id = $1 AND a.deleted_at IS NULL`,
    [userId],
  );
}

export function findById(agencyId) {
  return queryOne(
    `SELECT ${AGENCY} FROM agencies a WHERE a.id = $1 AND a.deleted_at IS NULL`,
    [agencyId],
  );
}

export function update(agencyId, patch) {
  return queryOne(
    `UPDATE agencies
        SET name = COALESCE($2, name),
            headline = COALESCE($3, headline),
            about = COALESCE($4, about),
            registration_no = COALESCE($5, registration_no),
            address_line = COALESCE($6, address_line),
            city = COALESCE($7, city),
            state = COALESCE($8, state),
            pincode = COALESCE($9, pincode)
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING ${AGENCY.replaceAll('a.', '')}`,
    [
      agencyId,
      patch.name ?? null,
      patch.headline ?? null,
      patch.about ?? null,
      patch.registrationNo ?? null,
      patch.addressLine ?? null,
      patch.city ?? null,
      patch.state ?? null,
      patch.pincode ?? null,
    ],
  );
}

/**
 * The agency's people, with enough of each one's activity to manage them.
 *
 * Money is counted but not broken down: earnings belong to the provider, and
 * the agency is shown the volume of work rather than the contents of someone
 * else's ledger.
 */
export function listProviders(agencyId) {
  return queryMany(
    `SELECT p.id, p.verification_status, p.is_accepting_bookings, p.rating_average,
            p.rating_count, p.jobs_completed, p.acceptance_rate, p.headline,
            p.deleted_at IS NOT NULL AS is_removed,
            u.id AS user_id, u.full_name, u.email, u.phone, u.status AS account_status,
            u.last_login_at, u.created_at,
            COALESCE(live.open_jobs, 0)::int AS open_jobs
       FROM provider_profiles p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS open_jobs
           FROM bookings b
          WHERE b.provider_id = p.id
            AND b.status IN ('requested', 'accepted', 'in_progress')
       ) live ON TRUE
      WHERE p.agency_id = $1
      ORDER BY u.full_name`,
    [agencyId],
  );
}

/** One of the agency's providers. Returns nothing for anyone else's. */
export function findProvider(agencyId, providerId) {
  return queryOne(
    `SELECT p.id, p.user_id, p.verification_status, p.is_accepting_bookings,
            u.full_name, u.email, u.phone, u.status AS account_status
       FROM provider_profiles p
       JOIN users u ON u.id = p.user_id
      WHERE p.id = $1 AND p.agency_id = $2`,
    [providerId, agencyId],
  );
}

/** Work across the whole agency, newest first. Scoped by the agency id in SQL. */
export async function listBookings(agencyId, { status, providerId, limit, offset }) {
  const where = ['p.agency_id = $1'];
  const params = [agencyId];
  const push = (v) => {
    params.push(v);
    return '$' + params.length;
  };

  if (status) where.push(`b.status = ${push(status)}::booking_status`);
  if (providerId) where.push(`b.provider_id = ${push(providerId)}`);

  const clause = 'WHERE ' + where.join(' AND ');

  const totalRow = await queryOne(
    `SELECT COUNT(*)::int AS total
       FROM bookings b JOIN provider_profiles p ON p.id = b.provider_id ${clause}`,
    params,
  );

  params.push(limit, offset);
  const items = await queryMany(
    `SELECT b.id, b.reference, b.status, b.scheduled_start, b.final_amount_minor,
            b.quoted_amount_minor, b.address_city, b.created_at,
            c.name AS category_name,
            u.full_name AS provider_name,
            cu.full_name AS customer_name
       FROM bookings b
       JOIN provider_profiles p ON p.id = b.provider_id
       JOIN users u ON u.id = p.user_id
       JOIN service_categories c ON c.id = b.category_id
       JOIN users cu ON cu.id = b.customer_id
       ${clause}
       ORDER BY b.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { items, total: totalRow.total };
}

/** Headline numbers for the agency dashboard. */
export function overview(agencyId) {
  return queryOne(
    `SELECT
       COUNT(DISTINCT p.id)::int AS providers,
       COUNT(DISTINCT p.id) FILTER (WHERE p.verification_status = 'approved')::int AS approved_providers,
       COUNT(DISTINCT p.id) FILTER (WHERE p.is_accepting_bookings)::int AS online_providers,
       COUNT(b.id)::int AS total_jobs,
       COUNT(b.id) FILTER (WHERE b.status IN ('requested','accepted','in_progress'))::int AS open_jobs,
       COUNT(b.id) FILTER (WHERE b.status = 'completed')::int AS completed_jobs,
       COALESCE(AVG(p.rating_average) FILTER (WHERE p.rating_count > 0), 0)::numeric(3,2) AS avg_rating
     FROM provider_profiles p
     LEFT JOIN bookings b ON b.provider_id = p.id
    WHERE p.agency_id = $1 AND p.deleted_at IS NULL`,
    [agencyId],
  );
}

/**
 * Pushes the agency's verification onto its providers.
 *
 * Run when an admin approves or suspends an agency. Providers that have their
 * own submission in flight are left alone - their own evidence outranks an
 * inherited status.
 */
export function cascadeVerification(tx, agencyId, status) {
  return (tx ?? { query }).query(
    `UPDATE provider_profiles
        SET verification_status = $2::verification_status,
            verified_at = CASE WHEN $2 = 'approved' THEN NOW() ELSE verified_at END
      WHERE agency_id = $1
        AND deleted_at IS NULL
        AND verification_status NOT IN ('pending', 'info_requested')`,
    [agencyId, status],
  );
}

export default {
  findByUserId, findById, update, listProviders, findProvider,
  listBookings, overview, cascadeVerification,
};
