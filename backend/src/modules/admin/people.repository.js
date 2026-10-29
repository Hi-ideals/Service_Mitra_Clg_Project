import { queryMany, queryOne } from '../../db/pool.js';

/**
 * The people directory.
 *
 * One query shape over `users`, left-joined to whichever profile the role
 * implies. A customer has neither profile, a provider has one, an agency owner
 * has the other - so the joins are left joins and the columns are null for
 * roles they do not apply to.
 */

/**
 * Headline counts.
 *
 * Counted in one pass rather than five round trips, and every count excludes
 * soft-deleted rows: a deleted account is not a user the platform has.
 *
 * "Verified" means approved, which is the only status that lets someone work.
 * Pending and rejected are counted separately because the difference is the
 * admin's whole workload.
 */
export function summary() {
  return queryOne(
    `SELECT
       COUNT(*) FILTER (WHERE u.role = 'customer')::int                        AS customers,
       COUNT(*) FILTER (WHERE u.role = 'provider')::int                        AS providers,
       COUNT(*) FILTER (WHERE u.role = 'agency')::int                          AS agencies,
       COUNT(*) FILTER (WHERE u.role = 'admin')::int                           AS admins,
       COUNT(*) FILTER (WHERE u.status = 'suspended')::int                     AS suspended,
       COUNT(*) FILTER (
         WHERE u.role = 'provider' AND p.verification_status = 'approved'
       )::int                                                                  AS verified_providers,
       COUNT(*) FILTER (
         WHERE u.role = 'provider' AND p.verification_status = 'pending'
       )::int                                                                  AS pending_providers,
       COUNT(*) FILTER (
         WHERE u.role = 'agency' AND a.verification_status = 'approved'
       )::int                                                                  AS verified_agencies,
       COUNT(*) FILTER (
         WHERE u.role = 'agency' AND a.verification_status = 'pending'
       )::int                                                                  AS pending_agencies,
       COUNT(*)::int                                                           AS total
     FROM users u
     LEFT JOIN provider_profiles p ON p.user_id = u.id AND p.deleted_at IS NULL
     LEFT JOIN agencies a ON a.user_id = u.id
    WHERE u.deleted_at IS NULL`,
  );
}

/**
 * Builds the WHERE clause both the list and its count share.
 *
 * Shared deliberately: a list and a total that disagree about what is being
 * filtered produce a pager that promises pages which are not there.
 */
function filters({ role, status, verification, search }) {
  const where = ['u.deleted_at IS NULL'];
  const params = [];

  if (role) {
    params.push(role);
    where.push('u.role = $' + params.length);
  }

  if (status) {
    params.push(status);
    where.push('u.status = $' + params.length);
  }

  if (verification) {
    params.push(verification);
    where.push(
      '(COALESCE(p.verification_status, a.verification_status)::text = $' + params.length + ')',
    );
  }

  if (search) {
    params.push('%' + search + '%');
    const n = params.length;
    where.push(
      '(u.full_name ILIKE $' + n +
        ' OR u.email::text ILIKE $' + n +
        ' OR u.phone ILIKE $' + n +
        ' OR a.name ILIKE $' + n +
        ' OR p.business_name ILIKE $' + n + ')',
    );
  }

  return { clause: where.join(' AND '), params };
}

const SELECT = `
  SELECT u.id, u.role, u.full_name, u.email, u.phone, u.status,
         u.email_verified_at, u.phone_verified_at, u.created_at,
         p.id              AS provider_id,
         p.business_name,
         p.verification_status AS provider_verification,
         p.is_accepting_bookings,
         p.jobs_completed,
         p.agency_id,
         a.id              AS agency_id_owned,
         a.name            AS agency_name,
         a.verification_status AS agency_verification,
         emp.name          AS employer_name
    FROM users u
    LEFT JOIN provider_profiles p ON p.user_id = u.id AND p.deleted_at IS NULL
    LEFT JOIN agencies a ON a.user_id = u.id
    LEFT JOIN agencies emp ON emp.id = p.agency_id`;

export function list({ role, status, verification, search }, { limit, offset }) {
  const { clause, params } = filters({ role, status, verification, search });
  params.push(limit, offset);

  return queryMany(
    `${SELECT}
      WHERE ${clause}
      ORDER BY u.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
}

export async function count({ role, status, verification, search }) {
  const { clause, params } = filters({ role, status, verification, search });

  const row = await queryOne(
    `SELECT COUNT(*)::int AS total
       FROM users u
       LEFT JOIN provider_profiles p ON p.user_id = u.id AND p.deleted_at IS NULL
       LEFT JOIN agencies a ON a.user_id = u.id
      WHERE ${clause}`,
    params,
  );
  return row.total;
}

export function findUser(id) {
  return queryOne(
    `SELECT u.id, u.role, u.full_name, u.email, u.status
       FROM users u
      WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [id],
  );
}

/**
 * Suspends or restores an account.
 *
 * The status lives on the user, so this stops them signing in whatever their
 * role. A suspended provider is also taken offline in the same statement -
 * leaving `is_accepting_bookings` true would show them in search until
 * something else happened to clear it.
 */
export async function setStatus(tx, userId, status) {
  const user = await tx.one(
    `UPDATE users SET status = $2::account_status
      WHERE id = $1 AND deleted_at IS NULL
    RETURNING id, role, full_name, email, status`,
    [userId, status],
  );

  if (status === 'suspended') {
    await tx.query(
      'UPDATE provider_profiles SET is_accepting_bookings = FALSE WHERE user_id = $1',
      [userId],
    );
  }

  return user;
}

export default { summary, list, count, findUser, setStatus };
