/**
 * Reading the audit trail.
 *
 * Writes go through audit.service.js. Nothing here updates or deletes: a log
 * that can be edited is not an audit log, so the only operations are reading
 * it and counting it.
 */
import { queryMany, queryOne } from '../../db/pool.js';

/**
 * Turns the filters into a WHERE clause and its parameters.
 *
 * Every value is a placeholder. The only thing interpolated into the SQL is
 * the placeholder number, which this function generates - nothing a caller
 * supplies reaches the statement text.
 */
function where(filters) {
  const clauses = [];
  const params = [];
  const next = (value) => {
    params.push(value);
    return '$' + params.length;
  };

  if (filters.action) clauses.push('a.action = ' + next(filters.action));
  if (filters.adminId) clauses.push('a.admin_id = ' + next(filters.adminId));
  if (filters.entityType) clauses.push('a.entity_type = ' + next(filters.entityType));
  if (filters.from) clauses.push('a.created_at >= ' + next(filters.from));
  // The end of the chosen day, not its first moment - otherwise picking today
  // as the end date returns nothing that happened today.
  if (filters.to) clauses.push('a.created_at < (' + next(filters.to) + '::date + INTERVAL \'1 day\')');

  if (filters.search) {
    const term = next('%' + filters.search + '%');
    clauses.push(
      '(a.reason ILIKE ' + term +
      ' OR adm.full_name ILIKE ' + term +
      ' OR adm.email ILIKE ' + term +
      ' OR a.action ILIKE ' + term + ')',
    );
  }

  return { sql: clauses.length ? 'WHERE ' + clauses.join(' AND ') : '', params };
}

/**
 * The joins that turn identifiers into names.
 *
 * An entry reading "suspended 7f3a-..." tells an admin nothing. Three joins
 * cover the entity types that are actually recorded against something a
 * person would recognise; everything else falls back to its type, which is
 * honest rather than blank.
 */
const FROM = `
    FROM admin_audit_log a
    LEFT JOIN users adm ON adm.id = a.admin_id
    LEFT JOIN users u ON a.entity_type = 'user' AND u.id = a.entity_id
    LEFT JOIN bookings b ON a.entity_type = 'booking' AND b.id = a.entity_id
    LEFT JOIN service_categories c ON a.entity_type = 'service_category' AND c.id = a.entity_id
`;

export async function list(filters, { limit, offset }) {
  const { sql, params } = where(filters);

  return queryMany(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.reason,
            a.before_state, a.after_state, a.ip_address, a.request_id, a.created_at,
            adm.full_name AS admin_name, adm.email AS admin_email, adm.id AS admin_id,
            COALESCE(u.full_name, b.reference, c.name) AS entity_name
       ${FROM}
       ${sql}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
}

export async function count(filters) {
  const { sql, params } = where(filters);
  const row = await queryOne(`SELECT COUNT(*)::int AS n ${FROM} ${sql}`, params);
  return row?.n ?? 0;
}

/**
 * What to offer in the filters.
 *
 * Read from the table rather than from the list of actions the code can
 * write, so the dropdown never offers a filter that would return nothing -
 * and never hides one written by a version of the code that has since moved
 * on.
 */
export async function facets() {
  const [actions, admins, entities] = await Promise.all([
    queryMany(
      `SELECT action, COUNT(*)::int AS n FROM admin_audit_log
        GROUP BY action ORDER BY action`,
    ),
    queryMany(
      `SELECT DISTINCT u.id, u.full_name, u.email
         FROM admin_audit_log a JOIN users u ON u.id = a.admin_id
        ORDER BY u.full_name`,
    ),
    queryMany(
      `SELECT entity_type, COUNT(*)::int AS n FROM admin_audit_log
        GROUP BY entity_type ORDER BY entity_type`,
    ),
  ]);

  return { actions, admins, entities };
}

/** Oldest and newest, so the screen can say how far back the trail goes. */
export function range() {
  return queryOne(
    'SELECT MIN(created_at) AS oldest, MAX(created_at) AS newest, COUNT(*)::int AS total FROM admin_audit_log',
  );
}

export default { list, count, facets, range };
