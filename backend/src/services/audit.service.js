/**
 * Admin audit trail.
 *
 * Admin endpoints skip the ownership check by design, so this is what keeps
 * them accountable instead. Every consequential admin action records who did
 * it, to what, and what the record looked like before and after.
 *
 * Writing the audit row must never fail the action it is describing - a failed
 * log is reported, not thrown.
 */
import { query } from '../db/pool.js';
import logger from '../config/logger.js';

export const AUDIT = Object.freeze({
  CATEGORY_CREATED: 'category.created',
  CATEGORY_UPDATED: 'category.updated',
  CATEGORY_DEACTIVATED: 'category.deactivated',
  CATEGORY_DELETED: 'category.deleted',
  PROVIDER_APPROVED: 'provider.approved',
  PROVIDER_REJECTED: 'provider.rejected',
  PROVIDER_SUSPENDED: 'provider.suspended',
  SETTINGS_UPDATED: 'settings.updated',
  // Separate from settings.updated: whoever controls outgoing mail controls
  // password-reset emails, so this is worth finding without reading through
  // every commission change.
  SMTP_UPDATED: 'settings.smtp_updated',
  BOOKING_CANCELLED: 'booking.cancelled_by_admin',
  REFUND_ISSUED: 'refund.issued',
  DISPUTE_RESOLVED: 'dispute.resolved',
  REVIEW_MODERATED: 'review.moderated',
  ACCOUNT_SUSPENDED: 'account.suspended',
  ACCOUNT_RESTORED: 'account.restored',
  // A backup is the whole database in one file, and an export is a readable
  // slice of it. Both leave the server, so both are recorded with who took
  // them - the audit trail is the only thing that can answer "who has a copy".
  BACKUP_CREATED: 'backup.created',
  BACKUP_DOWNLOADED: 'backup.downloaded',
  DATA_EXPORTED: 'data.exported',
});

export async function record(req, { action, entityType, entityId, before = null, after = null, reason = null }) {
  try {
    await query(
      `INSERT INTO admin_audit_log
         (admin_id, action, entity_type, entity_id, before_state, after_state, reason, ip_address, request_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        req.user?.id ?? null,
        action,
        entityType,
        entityId ?? null,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
        reason,
        req.ip ?? null,
        req.id ?? null,
      ],
    );
  } catch (err) {
    logger.error({ err, action, entityType, entityId }, 'Failed to write audit log entry');
  }
}

export default { record, AUDIT };
