/**
 * Admin governance and analytics routes.
 *
 * Every route here is admin-only and audit-logged where it changes something.
 * The analytics endpoints are read-only aggregates; the settings and payout
 * endpoints move real money, so they record who did what and why.
 */
import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { authenticate, reloadUser } from '../../middleware/authenticate.js';
import { adminOnly } from '../../middleware/authorize.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import * as controller from './admin.controller.js';
import * as schema from './admin.validation.js';

const router = Router();

router.use(authenticate, adminOnly);

// ---------- analytics ----------
router.get('/analytics/dashboard', validate({ query: schema.rangeSchema }), controller.dashboard);
router.get('/analytics/series', validate({ query: schema.seriesSchema }), controller.series);
router.get('/analytics/categories', validate({ query: schema.topSchema }), controller.categories);
router.get('/analytics/locations', validate({ query: schema.topSchema }), controller.locations);
router.get(
  '/analytics/providers',
  validate({ query: schema.providerPerformanceSchema }),
  controller.providerPerformance,
);

// ---------- reports ----------
// Read-only, row-level, and exportable. Separate from analytics on purpose:
// these are the rows you reconcile against a bank statement, not a dashboard.
router.get('/reports/services', validate({ query: schema.serviceReportSchema }), controller.serviceReport);
router.get('/reports/payouts', validate({ query: schema.payoutReportSchema }), controller.payoutReport);

// ---------- platform settings ----------
// ---------- people ----------
// The directory every other admin screen assumes exists: who is on the
// platform, whether they are verified, and the one control that stops an
// account being used at all.
router.get('/people/summary', controller.peopleSummary);
router.get('/people', validate({ query: schema.peopleListSchema }), controller.listPeople);
router.patch(
  '/people/:id/status',
  writeLimiter,
  validate({ params: schema.userIdParamSchema, body: schema.accountStatusSchema }),
  controller.setAccountStatus,
);

// ---------- audit trail ----------
//
// Read-only, and there is no route that writes or removes an entry. A log an
// admin can edit is not a log: the point of this table is that it describes
// what the people with the most power on the platform actually did.
router.get('/audit/filters', controller.auditFilters);
router.get('/audit', validate({ query: schema.auditQuerySchema }), controller.listAudit);

// ---------- mail server ----------
//
// Rate limited and audit logged. Whoever controls outgoing mail controls
// password-reset emails and can send messages that genuinely come from this
// domain, so this is among the most consequential screens in the console.
router.get('/settings/smtp', controller.getSmtp);
router.put(
  '/settings/smtp',
  writeLimiter,
  reloadUser,
  validate({ body: schema.smtpSchema }),
  controller.updateSmtp,
);
// reloadUser, because the test is sent to the admin's own address and the
// access token does not carry one - it holds an id, a role and a status.
router.post('/settings/smtp/test', writeLimiter, reloadUser, controller.testSmtp);

// ---------- backups ----------
//
// Fixed segments before the parameterised one, so `/backup/run` can never be
// read as a backup named "run".
//
// These are the most dangerous routes in the application: one file here holds
// every customer's address, every provider's bank details and every password
// hash. Admin-only, rate limited, and each download is written to the audit
// log before a byte is sent.
router.get('/backup/status', controller.backupStatus);
router.post('/backup/run', writeLimiter, controller.runBackup);
router.get(
  '/backup/file/:name',
  validate({ params: schema.backupFileParamSchema }),
  controller.downloadBackup,
);

// Readable extracts of the same data, for reconciliation rather than restore.
router.get(
  '/backup/export/:name',
  validate({ params: schema.datasetParamSchema }),
  controller.exportDataset,
);

router.get('/settings', controller.getSettings);
router.put(
  '/settings/:key',
  writeLimiter,
  validate({ params: schema.settingKeyParam }),
  controller.updateSetting,
);

// ---------- payouts ----------
router.get('/payouts', validate({ query: schema.payoutListSchema }), controller.listPayouts);
router.get('/payouts/preview', controller.payoutPreview);
router.post('/payouts/run', writeLimiter, controller.runPayouts);
router.post(
  '/payouts/providers/:id',
  writeLimiter,
  validate({ params: schema.idParamSchema }),
  controller.payProvider,
);

// Manual settlement: an admin moves the money themselves, then records it.
router.post(
  '/payouts/:id/mark-paid',
  writeLimiter,
  validate({ params: schema.idParamSchema, body: schema.markPaidSchema }),
  controller.markPayoutPaid,
);
router.post(
  '/payouts/:id/mark-failed',
  writeLimiter,
  validate({ params: schema.idParamSchema, body: schema.markFailedSchema }),
  controller.markPayoutFailed,
);

export default router;
