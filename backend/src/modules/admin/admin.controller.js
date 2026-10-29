import asyncHandler from '../../utils/asyncHandler.js';
import { ok, paginated } from '../../utils/apiResponse.js';
import ApiError from '../../utils/ApiError.js';
import logger from '../../config/logger.js';
import { q } from '../../middleware/validate.js';
import { getPagination } from '../../utils/pagination.js';
import { record, AUDIT } from '../../services/audit.service.js';
import settings from '../../services/settings.service.js';
import * as analytics from './analytics.service.js';
import * as payouts from './payout.service.js';
import * as reports from './reports.service.js';
import * as people from './people.service.js';
import * as dataExports from './export.service.js';
import * as backup from '../../services/backup.service.js';
import * as smtp from './smtp.service.js';
import * as audit from './audit.service.js';
import { settingSchemas } from './admin.validation.js';

// ---------- analytics ----------

export const dashboard = asyncHandler(async (req, res) => ok(res, await analytics.dashboard(q(req))));

export const series = asyncHandler(async (req, res) => {
  const query = q(req);
  return ok(res, await analytics.series(query, query.granularity));
});

export const categories = asyncHandler(async (req, res) => {
  const query = q(req);
  return ok(res, await analytics.categories(query, query.limit));
});

export const locations = asyncHandler(async (req, res) => {
  const query = q(req);
  return ok(res, await analytics.locations(query, query.limit));
});

export const providerPerformance = asyncHandler(async (req, res) => {
  const query = q(req);
  return ok(res, await analytics.providers(query, { limit: query.limit, sort: query.sort }));
});

// ---------- settings ----------

export const getSettings = asyncHandler(async (_req, res) => {
  // The mail settings are deliberately left out of this one. They hold an
  // encrypted credential, they have a screen of their own that knows not to
  // send it, and a general settings dump is the wrong place for either.
  const { smtp: _smtp, ...rest } = await settings.all({ fresh: true });
  return ok(res, rest);
});

export const updateSetting = asyncHandler(async (req, res) => {
  const { key } = req.params;
  const schema = settingSchemas[key];
  if (!schema) throw ApiError.badRequest('Unknown setting "' + key + '"');

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(422, 'Validation failed', {
      code: 'VALIDATION_FAILED',
      details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }

  const before = await settings.get(key);
  const updated = await settings.update(key, parsed.data, req.user.id);

  await record(req, {
    action: AUDIT.SETTINGS_UPDATED,
    entityType: 'platform_setting',
    entityId: null,
    before: { key, value: before },
    after: { key, value: parsed.data },
    reason: 'Setting "' + key + '" updated',
  });

  return ok(res, updated, { message: 'Setting updated. It applies to new bookings from now on.' });
});

// ---------- reports ----------

/**
 * Sends a report either as JSON for the screen or as a CSV download.
 *
 * The filename carries the date the export was taken. An export called
 * "payouts.csv" is indistinguishable from every other one the moment it
 * reaches somebody's downloads folder.
 */
function sendReport(res, { format, name, columns, report }) {
  if (format !== 'csv') return ok(res, report, { meta: { total: report.total } });

  const filename = name + '-' + new Date().toISOString().slice(0, 10) + '.csv';

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  // A report is a point-in-time extract; a cached one is a wrong one.
  res.setHeader('Cache-Control', 'private, no-store');

  return res.send(reports.toCsv(columns, report.rows));
}

export const serviceReport = asyncHandler(async (req, res) => {
  const query = q(req);
  const { page, limit, offset } = getPagination(query);

  // A CSV is meant to be the whole filtered set, so it ignores the page size
  // the screen uses and takes the explicit limit instead.
  const window = query.format === 'csv' ? { limit: query.limit, offset: 0 } : { limit, offset };
  const report = await reports.services(query, window);

  return sendReport(res, {
    format: query.format,
    name: 'servicesetu-services',
    columns: reports.SERVICE_COLUMNS,
    report: { ...report, page, limit },
  });
});

export const payoutReport = asyncHandler(async (req, res) => {
  const query = q(req);
  const { page, limit, offset } = getPagination(query);

  const window = query.format === 'csv' ? { limit: query.limit, offset: 0 } : { limit, offset };
  const report = await reports.payouts(query, window);

  return sendReport(res, {
    format: query.format,
    name: 'servicesetu-payouts',
    columns: reports.PAYOUT_COLUMNS,
    report: { ...report, page, limit },
  });
});

// ---------- payouts ----------

export const payoutPreview = asyncHandler(async (_req, res) => ok(res, await payouts.preview()));

export const runPayouts = asyncHandler(async (req, res) => {
  const result = await payouts.runBatch();

  await record(req, {
    action: 'payout.batch_run',
    entityType: 'payout',
    entityId: null,
    after: { attempted: result.attempted, paid: result.paid, totalPaidMinor: result.totalPaidMinor },
  });

  // The wording has to tell the truth about what happened. In manual mode
  // nothing has been sent yet - it has been queued for a human to transfer.
  const message =
    result.mode === 'manual'
      ? result.prepared + ' of ' + result.attempted + ' payouts ready to transfer'
      : result.paid + ' of ' + result.attempted + ' payouts sent';

  return ok(res, result, { message });
});

export const payProvider = asyncHandler(async (req, res) => {
  const result = await payouts.payProvider(req.params.id);

  await record(req, {
    action: 'payout.single',
    entityType: 'provider_profile',
    entityId: req.params.id,
    after: result,
  });

  return ok(res, result, {
    message:
      result.status === 'pending'
        ? 'Payout prepared. Transfer ' + result.amount + ' and mark it paid.'
        : 'Payout sent',
  });
});

export const markPayoutPaid = asyncHandler(async (req, res) => {
  const result = await payouts.markPaid(req.params.id, req.user.id, req.body);

  await record(req, {
    action: 'payout.marked_paid',
    entityType: 'payout',
    entityId: req.params.id,
    after: { status: 'paid', paymentReference: result.paymentReference, amountMinor: result.amountMinor },
  });

  return ok(res, result, { message: 'Recorded as paid. The provider has been notified.' });
});

export const markPayoutFailed = asyncHandler(async (req, res) => {
  const result = await payouts.markFailed(req.params.id, req.user.id, req.body);

  await record(req, {
    action: 'payout.marked_failed',
    entityType: 'payout',
    entityId: req.params.id,
    after: { status: 'failed' },
    reason: req.body.reason,
  });

  return ok(res, result, { message: 'Marked as failed. The earnings are payable again.' });
});

export const listPayouts = asyncHandler(async (req, res) => {
  const query = q(req);
  const { page, limit, offset } = getPagination(query);

  // A CSV is the whole filtered history rather than one page of it.
  const window = query.format === 'csv' ? { limit: query.limit ?? 5000, offset: 0 } : { limit, offset };
  const result = await payouts.listPayouts({ ...query, ...window });

  if (query.format === 'csv') {
    return sendReport(res, {
      format: 'csv',
      name: 'servicemitra-payouts',
      columns: payouts.PAYOUT_HISTORY_COLUMNS,
      report: { rows: result.items, total: result.total },
    });
  }

  return paginated(res, result.items, { page, limit, total: result.total });
});

// ---------- people ----------

export const peopleSummary = asyncHandler(async (req, res) => ok(res, await people.summary()));

export const listPeople = asyncHandler(async (req, res) => {
  const query = q(req);
  const { page, limit, offset } = getPagination(query);

  // A CSV is the whole filtered set, so it ignores the page size the screen
  // uses and takes the explicit limit instead.
  const window = query.format === 'csv' ? { limit: query.limit ?? 5000, offset: 0 } : { limit, offset };
  const result = await people.list(query, window);

  if (query.format === 'csv') {
    return sendReport(res, {
      format: 'csv',
      name: 'servicemitra-people',
      columns: people.PEOPLE_COLUMNS,
      report: result,
    });
  }

  return paginated(res, result.rows, { page, limit, total: result.total });
});

export const setAccountStatus = asyncHandler(async (req, res) => {
  const result = await people.setStatus(req.params.id, req.body, req.user.id);

  await record(req, {
    action: req.body.status === 'suspended' ? AUDIT.ACCOUNT_SUSPENDED : AUDIT.ACCOUNT_RESTORED,
    entityType: 'user',
    entityId: req.params.id,
    after: result,
    reason: req.body.reason ?? null,
  });

  return ok(res, result, {
    message: req.body.status === 'suspended' ? 'Account suspended' : 'Account restored',
  });
});

// ---------- audit trail ----------

export const listAudit = asyncHandler(async (req, res) => {
  const query = q(req);
  const { page, limit, offset } = getPagination(query);

  // A CSV is meant to be the whole filtered set, not the page on screen.
  const window = query.format === 'csv' ? { limit: query.limit ?? 5000, offset: 0 } : { limit, offset };
  const result = await audit.search(query, window);

  if (query.format === 'csv') {
    return sendReport(res, {
      format: 'csv',
      name: 'servicemitra-audit-log',
      columns: audit.AUDIT_COLUMNS,
      report: result,
    });
  }

  return paginated(res, result.rows, { page, limit, total: result.total });
});

export const auditFilters = asyncHandler(async (_req, res) =>
  ok(res, { ...(await audit.filters()), coverage: await audit.coverage() }));

// ---------- mail server ----------

export const getSmtp = asyncHandler(async (req, res) => ok(res, await smtp.current()));

export const updateSmtp = asyncHandler(async (req, res) => {
  const before = await smtp.current();
  const after = await smtp.save(req.body, req.user.id);

  await record(req, {
    action: AUDIT.SMTP_UPDATED,
    entityType: 'platform_setting',
    entityId: null,
    // The password is never in either of these - `current()` reports only
    // whether one exists.
    before,
    after,
    reason: after.enabled ? 'Mail server set to ' + after.host : 'Mail server turned off',
  });

  return ok(res, after, {
    message: after.enabled
      ? 'Mail settings saved and tested. Email will now go out through ' + after.host + '.'
      : 'Mail settings saved. Email falls back to the server configuration.',
  });
});

export const testSmtp = asyncHandler(async (req, res) => {
  // To the admin's own address. Letting the sender be chosen would turn this
  // into a way of mailing anyone from your domain.
  const to = req.user.email;
  if (!to) throw ApiError.badRequest('Your account has no email address to send a test to');

  return ok(res, await smtp.sendTest(to), { message: 'Test email sent to ' + to });
});

// ---------- backups ----------

/**
 * A real server backup, not a spreadsheet.
 *
 * `pg_dump` of the whole database plus a tar of the uploaded documents, which
 * between them can rebuild this platform on a bare server. The CSV exports
 * below are a different thing for a different purpose, and the screen says so.
 */
export const backupStatus = asyncHandler(async (req, res) =>
  ok(res, { ...(await backup.status()), exports: await dataExports.summary() }));

export const runBackup = asyncHandler(async (req, res) => {
  const tools = await backup.toolStatus();
  // Checked before starting rather than after failing: the error a missing
  // pg_dump produces halfway through says nothing an admin can act on.
  if (!tools.ok) throw ApiError.badRequest(tools.problem ?? 'Backups are not available on this server');

  let result;
  try {
    result = await backup.runBackup({ trigger: 'manual' });
  } catch (err) {
    // Rethrown as an operational error on purpose. Everything else becomes a
    // generic 500, and "Something went wrong" is useless to the one person who
    // can fix a backup - the route is admin-only and the detail is what makes
    // the difference between finding the cause now and finding it in a crisis.
    logger.error({ err }, 'Manual backup failed');
    throw new ApiError(500, 'The backup failed: ' + err.message, { code: 'BACKUP_FAILED' });
  }

  await record(req, {
    action: AUDIT.BACKUP_CREATED,
    entityType: 'backup',
    entityId: null,
    after: { group: result.group, files: result.files.map((f) => f.name) },
    reason: 'Backup taken from the admin console',
  });

  let message = 'Backup complete';
  if (result.uploadsError) {
    message = 'Database backed up. The uploaded documents could not be archived: ' + result.uploadsError;
  } else if (result.joined) {
    // Honest about what happened: a backup was already running and this
    // request waited for it rather than starting a second one.
    message = 'A backup was already running. It has just finished.';
  }

  return ok(res, result, { message });
});

export const downloadBackup = asyncHandler(async (req, res) => {
  const file = await backup.fileFor(req.params.name);

  // Recorded before the file is sent, not after. A download that is recorded
  // only on completion is one an attacker can take without leaving a trace by
  // dropping the connection at the end.
  await record(req, {
    action: AUDIT.BACKUP_DOWNLOADED,
    entityType: 'backup',
    entityId: null,
    after: { file: req.params.name, bytes: file.bytes },
    reason: 'Backup downloaded from the admin console',
  });

  // Content-Length is left to res.sendFile. Setting it here is not merely
  // redundant - it is wrong for a range request, where the body is a slice of
  // the file rather than all of it.
  res.setHeader('Content-Type', file.type);
  res.setHeader('Content-Disposition', 'attachment; filename="' + req.params.name + '"');
  res.setHeader('Cache-Control', 'private, no-store');

  // res.sendFile rather than a manual stream: it handles range requests and
  // destroys the response on a read error instead of ending it cleanly, so a
  // half-sent backup arrives as a failed download rather than a short file.
  return res.sendFile(file.path);
});

// ---------- readable exports ----------

export const exportDataset = asyncHandler(async (req, res) => {
  const { rows, columns } = await dataExports.dataset(req.params.name);

  await record(req, {
    action: AUDIT.DATA_EXPORTED,
    entityType: 'export',
    entityId: null,
    after: { dataset: req.params.name, rows: rows.length },
    reason: 'Exported ' + req.params.name + ' as CSV',
  });

  return sendReport(res, {
    format: 'csv',
    name: 'servicemitra-' + req.params.name,
    columns,
    report: { rows, total: rows.length },
  });
});

export default {
  backupStatus, runBackup, downloadBackup, exportDataset,
  getSmtp, updateSmtp, testSmtp,
  listAudit, auditFilters,
  dashboard, series, categories, locations, providerPerformance,
  getSettings, updateSetting, payoutPreview, runPayouts, payProvider, listPayouts,
  markPayoutPaid, markPayoutFailed, serviceReport, payoutReport,
  peopleSummary, listPeople, setAccountStatus,
};
