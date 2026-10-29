/**
 * Storage for two-factor secrets and recovery codes.
 *
 * Nothing here decrypts anything or decides anything - it moves rows. The
 * secret arrives already encrypted and leaves the same way.
 */
import { query, queryOne, queryMany, withTransaction } from '../../db/pool.js';

export function findByUser(userId) {
  return queryOne(
    'SELECT user_id, secret_encrypted, confirmed_at, last_step FROM user_totp WHERE user_id = $1',
    [userId],
  );
}

/**
 * Writes a secret that is not yet in force.
 *
 * Replaces any half-finished attempt: starting setup again should hand out a
 * fresh secret rather than resurrecting one from a QR code the person has
 * already thrown away. A *confirmed* row is left alone - turning 2FA off is a
 * separate, deliberate act with its own checks.
 */
export function startSetup(userId, secretEncrypted) {
  return queryOne(
    `INSERT INTO user_totp (user_id, secret_encrypted)
          VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE
            SET secret_encrypted = EXCLUDED.secret_encrypted,
                last_step = NULL
          WHERE user_totp.confirmed_at IS NULL
      RETURNING user_id, secret_encrypted, confirmed_at`,
    [userId, secretEncrypted],
  );
}

/** Turns it on, and replaces the recovery codes in the same transaction. */
export function confirm(userId, step, codeHashes) {
  return withTransaction(async (tx) => {
    await tx.query(
      'UPDATE user_totp SET confirmed_at = NOW(), last_step = $2 WHERE user_id = $1',
      [userId, step],
    );
    await tx.query('DELETE FROM totp_recovery_codes WHERE user_id = $1', [userId]);

    for (const hash of codeHashes) {
      await tx.query(
        'INSERT INTO totp_recovery_codes (user_id, code_hash) VALUES ($1, $2)',
        [userId, hash],
      );
    }
  });
}

export function replaceRecoveryCodes(userId, codeHashes) {
  return withTransaction(async (tx) => {
    await tx.query('DELETE FROM totp_recovery_codes WHERE user_id = $1', [userId]);
    for (const hash of codeHashes) {
      await tx.query(
        'INSERT INTO totp_recovery_codes (user_id, code_hash) VALUES ($1, $2)',
        [userId, hash],
      );
    }
  });
}

/**
 * Records the time-step a code was accepted at.
 *
 * Guarded by `last_step IS NULL OR last_step < $2` so two requests racing with
 * the same code cannot both succeed: the second update matches no row. The
 * caller treats zero rows as a rejection.
 */
export async function consumeStep(userId, step) {
  const { rowCount } = await query(
    `UPDATE user_totp SET last_step = $2
      WHERE user_id = $1 AND (last_step IS NULL OR last_step < $2)`,
    [userId, step],
  );
  return rowCount === 1;
}

/**
 * Spends a recovery code, if it is one of this account's unused ones.
 *
 * The update itself is the check: `used_at IS NULL` in the WHERE clause means
 * two simultaneous attempts with the same code cannot both be accepted.
 */
export async function consumeRecoveryCode(userId, codeHash) {
  const { rowCount } = await query(
    `UPDATE totp_recovery_codes SET used_at = NOW()
      WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL`,
    [userId, codeHash],
  );
  return rowCount === 1;
}

export async function countUnusedRecoveryCodes(userId) {
  const row = await queryOne(
    'SELECT COUNT(*)::int AS n FROM totp_recovery_codes WHERE user_id = $1 AND used_at IS NULL',
    [userId],
  );
  return row?.n ?? 0;
}

export function disable(userId) {
  return withTransaction(async (tx) => {
    await tx.query('DELETE FROM totp_recovery_codes WHERE user_id = $1', [userId]);
    await tx.query('DELETE FROM user_totp WHERE user_id = $1', [userId]);
  });
}

/** Used by the login path, which must not pay for a join on every sign-in. */
export async function isEnabled(userId) {
  const row = await queryOne(
    'SELECT 1 AS on FROM user_totp WHERE user_id = $1 AND confirmed_at IS NOT NULL',
    [userId],
  );
  return Boolean(row);
}

export const listCodes = (userId) =>
  queryMany(
    'SELECT code_hash, used_at FROM totp_recovery_codes WHERE user_id = $1 ORDER BY created_at',
    [userId],
  );
