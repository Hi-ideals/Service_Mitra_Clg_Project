import { queryMany, queryOne, withTransaction } from '../../db/pool.js';

const COLUMNS = `id, label, line1, line2, landmark, city, state, pincode,
                 latitude, longitude, is_default, created_at`;

/** The customer's saved addresses, default first, then most recent. */
export function listForUser(userId) {
  return queryMany(
    `SELECT ${COLUMNS}
       FROM addresses
      WHERE user_id = $1 AND deleted_at IS NULL
      ORDER BY is_default DESC, created_at DESC`,
    [userId],
  );
}

export function findForUser(id, userId) {
  return queryOne(
    `SELECT ${COLUMNS} FROM addresses
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [id, userId],
  );
}

/**
 * Saves an address, and keeps "default" to one per customer.
 *
 * A partial unique index enforces that, so clearing the old default has to
 * happen in the same transaction as setting the new one - two statements
 * outside a transaction would collide with the index in between.
 */
export function create(userId, d) {
  return withTransaction(async (tx) => {
    if (d.isDefault) {
      await tx.query(
        'UPDATE addresses SET is_default = FALSE WHERE user_id = $1 AND deleted_at IS NULL',
        [userId],
      );
    }

    // The first address a customer saves is their default whatever they asked
    // for: a list where nothing is default makes the booking form pick
    // arbitrarily.
    const existing = await tx.one(
      'SELECT COUNT(*)::int AS n FROM addresses WHERE user_id = $1 AND deleted_at IS NULL',
      [userId],
    );

    return tx.one(
      `INSERT INTO addresses
         (user_id, label, line1, line2, landmark, city, state, pincode, latitude, longitude, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING ${COLUMNS}`,
      [
        userId, d.label, d.line1, d.line2 ?? null, d.landmark ?? null,
        d.city, d.state, d.pincode, d.latitude ?? null, d.longitude ?? null,
        d.isDefault || existing.n === 0,
      ],
    );
  });
}

export function setDefault(id, userId) {
  return withTransaction(async (tx) => {
    await tx.query(
      'UPDATE addresses SET is_default = FALSE WHERE user_id = $1 AND deleted_at IS NULL',
      [userId],
    );
    return tx.one(
      `UPDATE addresses SET is_default = TRUE
        WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
      RETURNING ${COLUMNS}`,
      [id, userId],
    );
  });
}

/**
 * Soft delete.
 *
 * Bookings reference an address by id, and a hard delete would strip the
 * record from a booking that has already happened. The booking keeps its own
 * snapshot of the address text regardless, but the link is worth keeping.
 */
export function remove(id, userId) {
  return queryOne(
    `UPDATE addresses SET deleted_at = NOW()
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
    RETURNING id`,
    [id, userId],
  );
}

export default { listForUser, findForUser, create, setDefault, remove };
