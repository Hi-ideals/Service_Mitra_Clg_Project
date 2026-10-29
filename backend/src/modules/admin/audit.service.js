/**
 * The audit trail, made readable.
 *
 * Admin endpoints skip the ownership checks that protect everything else -
 * that is what being an admin means - so this trail is what stands in their
 * place. It only does that job if somebody can actually read it, which is
 * what this module is for: turning `account.suspended` and a UUID into a
 * sentence naming who did what, to whom, and when.
 */
import * as repo from './audit.repository.js';

/**
 * What each recorded action is called in plain words.
 *
 * Anything missing falls back to humanising the key itself, so an action
 * added later shows up as readable text rather than a gap - the log must
 * never hide an entry just because this list is out of date.
 */
const LABELS = {
  'category.created': 'Category created',
  'category.updated': 'Category updated',
  'category.deactivated': 'Category deactivated',
  'category.deleted': 'Category deleted',
  'provider.approved': 'Provider approved',
  'provider.rejected': 'Provider rejected',
  'provider.suspended': 'Provider suspended',
  'kyc.info_requested': 'More documents requested',
  'settings.updated': 'Platform settings changed',
  'settings.smtp_updated': 'Mail server changed',
  'booking.cancelled_by_admin': 'Booking cancelled by admin',
  'refund.issued': 'Refund issued',
  'dispute.resolved': 'Dispute resolved',
  'review.moderated': 'Review moderated',
  'account.suspended': 'Account suspended',
  'account.restored': 'Account restored',
  'backup.created': 'Backup taken',
  'backup.downloaded': 'Backup downloaded',
  'data.exported': 'Data exported',
};

export function label(action) {
  if (LABELS[action]) return LABELS[action];

  const words = String(action).replace(/[._]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * How serious an entry is, so the screen can weight them.
 *
 * Not a severity in the security sense - everything here was done by someone
 * authorised. It marks the entries worth noticing in a long list: a copy of
 * the database leaving the platform, money moving, somebody losing access.
 */
const WEIGHTY = new Set([
  'backup.downloaded',
  'data.exported',
  'account.suspended',
  'provider.suspended',
  'refund.issued',
  'settings.smtp_updated',
  'settings.updated',
]);

/**
 * The fields that actually changed, rather than both states in full.
 *
 * A settings entry carries a dozen unchanged keys around the one that moved,
 * and reading it means comparing two blocks of JSON by eye. This does that
 * comparison once.
 */
export function changes(before, after) {
  if (!before && !after) return [];

  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  const out = [];

  for (const key of keys) {
    const from = before?.[key];
    const to = after?.[key];
    if (JSON.stringify(from) === JSON.stringify(to)) continue;

    out.push({
      field: key,
      from: from === undefined ? null : from,
      to: to === undefined ? null : to,
    });
  }

  return out;
}

function present(row) {
  return {
    id: String(row.id),
    action: row.action,
    label: label(row.action),
    notable: WEIGHTY.has(row.action),
    admin: row.admin_id
      ? { id: row.admin_id, name: row.admin_name, email: row.admin_email }
      // An admin account that was deleted leaves its entries behind, with the
      // reference nulled. Losing the name must not lose the record.
      : null,
    entity: {
      type: row.entity_type,
      id: row.entity_id,
      name: row.entity_name ?? null,
    },
    reason: row.reason,
    changes: changes(row.before_state, row.after_state),
    ip: readableIp(row.ip_address),
    requestId: row.request_id,
    at: row.created_at,
  };
}

/**
 * The address as a person should read it.
 *
 * Nothing here is truncated - these are the full addresses, they simply do
 * not all look like 203.0.113.44:
 *
 *   ::ffff:203.0.113.44  an ordinary IPv4 client arriving over an IPv6
 *                        socket. The ::ffff: is Node's wrapper, not part of
 *                        the address, so it is unwrapped.
 *
 *   ::1                  IPv6 loopback - the request came from the server
 *                        itself. Complete, and short because every other
 *                        digit in it is a zero.
 *
 * The loopback case is spelled out rather than left as two colons and a one,
 * which reads in a spreadsheet like a value that got cut off.
 */
export function readableIp(value) {
  if (!value) return '';

  const address = String(value).trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  const plain = mapped ? mapped[1] : address;

  if (plain === '::1' || plain === '127.0.0.1') {
    return plain + ' (the server itself)';
  }

  return plain;
}

export async function search(filters, window) {
  const [rows, total] = await Promise.all([repo.list(filters, window), repo.count(filters)]);
  return { rows: rows.map(present), total };
}

export const filters = () => repo.facets();
export const coverage = () => repo.range();

/** For the CSV. Flattened, because a spreadsheet cannot hold nested changes. */
export const AUDIT_COLUMNS = [
  // ISO, not a local format. A CSV is read by a spreadsheet and sorted by
  // this column, and a pretty date sorts alphabetically into nonsense.
  { header: 'When', value: (r) => new Date(r.at).toISOString() },
  { header: 'Action', value: (r) => r.label },
  { header: 'Admin', value: (r) => r.admin?.name ?? 'Deleted account' },
  { header: 'Admin email', value: (r) => r.admin?.email ?? '' },
  { header: 'Affected', value: (r) => r.entity.name ?? r.entity.type },
  { header: 'Type', value: (r) => r.entity.type },
  { header: 'Reason', value: (r) => r.reason ?? '' },
  {
    header: 'Changed',
    value: (r) =>
      r.changes
        .map((c) => c.field + ': ' + JSON.stringify(c.from) + ' -> ' + JSON.stringify(c.to))
        .join('; '),
  },
  { header: 'IP address', value: (r) => r.ip ?? '' },
];

export default { search, filters, coverage, label, changes, AUDIT_COLUMNS };
