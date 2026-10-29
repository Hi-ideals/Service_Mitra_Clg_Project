/**
 * Data access for the identity domain. Typed queries only - no business rules
 * and no authorisation decisions live here.
 */
import { query, queryOne } from '../../db/pool.js';

const PUBLIC_COLUMNS = `
  u.id, u.role, u.full_name, u.email, u.phone, u.avatar_url, u.status,
  u.email_verified_at, u.phone_verified_at, u.last_login_at, u.created_at
`;

export function findById(id) {
  return queryOne(
    `SELECT ${PUBLIC_COLUMNS}, p.id AS provider_id, p.verification_status,
            a.id AS agency_id, a.name AS agency_name, a.verification_status AS agency_verification
       FROM users u
       LEFT JOIN provider_profiles p ON p.user_id = u.id AND p.deleted_at IS NULL
       LEFT JOIN agencies a ON a.user_id = u.id AND a.deleted_at IS NULL
      WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [id],
  );
}

/** Includes the password hash - used only by the sign-in path. */
export function findForLogin(identifier) {
  return queryOne(
    `SELECT u.id, u.role, u.full_name, u.email, u.phone, u.password_hash, u.status,
            u.email_verified_at, u.phone_verified_at,
            p.id AS provider_id, p.verification_status,
            a.id AS agency_id, a.verification_status AS agency_verification
       FROM users u
       LEFT JOIN provider_profiles p ON p.user_id = u.id AND p.deleted_at IS NULL
       LEFT JOIN agencies a ON a.user_id = u.id AND a.deleted_at IS NULL
      WHERE (u.email = $1 OR u.phone = $1) AND u.deleted_at IS NULL`,
    [identifier],
  );
}

export function findByEmailOrPhone(email, phone) {
  return queryOne(
    `SELECT id, email, phone, role, email_verified_at FROM users
      WHERE deleted_at IS NULL
        AND ((email IS NOT NULL AND email = $1) OR (phone IS NOT NULL AND phone = $2))`,
    [email ?? null, phone ?? null],
  );
}

export async function createUser(tx, { role, fullName, email, phone, passwordHash }) {
  return tx.one(
    `INSERT INTO users (role, full_name, email, phone, password_hash)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, role, full_name, email, phone, status, created_at`,
    [role, fullName, email ?? null, phone ?? null, passwordHash],
  );
}

/** A provider account is useless without its profile, so both are created together. */
export async function createProviderProfile(tx, userId, { agencyId = null, verificationStatus = 'unsubmitted' } = {}) {
  return tx.one(
    `INSERT INTO provider_profiles (user_id, verification_status, agency_id)
     VALUES ($1, $2::verification_status, $3)
     RETURNING id, verification_status, agency_id`,
    [userId, verificationStatus, agencyId],
  );
}

/** The same for an agency: the account and the business record are one step. */
export async function createAgency(tx, userId, { name }) {
  return tx.one(
    `INSERT INTO agencies (user_id, name, verification_status)
     VALUES ($1, $2, 'unsubmitted')
     RETURNING id, name, verification_status`,
    [userId, name],
  );
}

export function markContactVerified(userId, field) {
  const column = field === 'email' ? 'email_verified_at' : 'phone_verified_at';
  return query(`UPDATE users SET ${column} = NOW() WHERE id = $1`, [userId]);
}

export function touchLastLogin(userId) {
  return query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);
}

/**
 * The same shape as `findForLogin`, by id.
 *
 * Used to finish a two-factor sign-in, where the account was identified by the
 * first half and must be re-read - not trusted from a token - before a session
 * is issued.
 */
export function findForLoginById(id) {
  return queryOne(
    `SELECT u.id, u.role, u.full_name, u.email, u.phone, u.password_hash, u.status,
            u.email_verified_at, u.phone_verified_at, u.avatar_url, u.created_at,
            p.id AS provider_id, p.verification_status,
            a.id AS agency_id, a.verification_status AS agency_verification
       FROM users u
       LEFT JOIN provider_profiles p ON p.user_id = u.id AND p.deleted_at IS NULL
       LEFT JOIN agencies a ON a.user_id = u.id AND a.deleted_at IS NULL
      WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [id],
  );
}

/**
 * Removes an account that never confirmed its contact details.
 *
 * A hard delete, not a soft one. Everything hanging off a user - the provider
 * profile, the agency, any outstanding codes and sessions - is declared
 * ON DELETE CASCADE, so this leaves nothing orphaned. There is nothing worth
 * keeping either: an account that was never confirmed could never sign in, so
 * it has no bookings, no invoices and no history.
 *
 * The WHERE clause is the safety catch. If a verification lands between the
 * read that decided to call this and the delete itself, this matches no rows
 * and a real account survives.
 */
export async function deleteUnverified(userId) {
  const { rowCount } = await query(
    "DELETE FROM users WHERE id = $1 AND email_verified_at IS NULL AND role <> 'admin'",
    [userId],
  );
  return rowCount === 1;
}

export function updatePassword(userId, passwordHash) {
  return query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, passwordHash]);
}

export function getPasswordHash(userId) {
  return queryOne('SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL', [userId]);
}

export function updateProfile(userId, { fullName, avatarUrl }) {
  return queryOne(
    `UPDATE users
        SET full_name = COALESCE($2, full_name),
            avatar_url = COALESCE($3, avatar_url)
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING ${PUBLIC_COLUMNS.replaceAll('u.', '')}`,
    [userId, fullName ?? null, avatarUrl ?? null],
  );
}

export default {
  findById,
  findForLogin,
  findByEmailOrPhone,
  deleteUnverified,
  createUser,
  createProviderProfile,
  markContactVerified,
  touchLastLogin,
  updatePassword,
  getPasswordHash,
  updateProfile,
};
