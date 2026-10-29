import { z } from 'zod';

const isoDate = z.string().datetime({ offset: true }).optional();

export const rangeSchema = z.object({
  from: isoDate,
  to: isoDate,
});

export const seriesSchema = rangeSchema.extend({
  granularity: z.enum(['day', 'week', 'month']).default('day'),
});

export const topSchema = rangeSchema.extend({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const providerPerformanceSchema = rangeSchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['revenue', 'bookings', 'rating', 'completion']).default('revenue'),
});

/**
 * Settings are typed per key rather than accepted as free-form JSON - a typo
 * in a commission percentage is a money bug, so it is rejected at the edge.
 */
export const settingSchemas = {
  commission: z.object({
    defaultPercent: z.coerce.number().min(0).max(50, 'A commission above 50% needs a policy decision, not a form'),
  }),
  payout: z.object({
    schedule: z.enum(['daily', 'weekly', 'fortnightly', 'monthly']),
    dayOfWeek: z.coerce.number().int().min(0).max(6).optional(),
    minimumAmountMinor: z.coerce.number().int().min(0),
  }),
  cancellation: z.object({
    freeWindowHours: z.coerce.number().int().min(0).max(168),
    lateFeePercent: z.coerce.number().min(0).max(100),
    noShowFeePercent: z.coerce.number().min(0).max(100),
  }),
  booking: z.object({
    acceptWindowMinutes: z.coerce.number().int().min(5).max(1440),
    disputeWindowHours: z.coerce.number().int().min(1).max(720),
    maxAdvanceDays: z.coerce.number().int().min(1).max(365),
  }),
  tax: z.object({
    gstPercent: z.coerce.number().min(0).max(100),
    inclusive: z.coerce.boolean(),
  }),
};

export const settingKeyParam = z.object({
  key: z.enum(Object.keys(settingSchemas)),
});

export const payoutListSchema = z.object({
  providerId: z.string().uuid().optional(),
  status: z.enum(['pending', 'processing', 'paid', 'failed', 'on_hold']).optional(),
  format: z.enum(['json', 'csv']).default('json'),
  page: z.coerce.number().int().min(1).default(1),
  // 50 is a screenful; an export is the whole filtered history, with a ceiling
  // all the same because an unbounded one is a way to take the ledger out over
  // HTTP.
  limit: z.coerce.number().int().min(1).max(5000).default(20),
});

/**
 * Marking a payout paid requires the reference the bank gave back - the UTR,
 * UPI transaction id or NEFT reference. Without it the record asserts a
 * transfer happened with nothing to trace.
 */
export const markPaidSchema = z.object({
  paymentReference: z
    .string()
    .trim()
    .min(4, 'Enter the bank or UPI reference for this transfer')
    .max(64, 'That reference looks too long'),
  notes: z.string().trim().max(500).optional(),
});

export const markFailedSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(4, 'Say why the transfer did not go through')
    .max(500, 'Keep the reason under 500 characters'),
});

/**
 * Report filters.
 *
 * The export limit is far higher than the on-screen one: a CSV that silently
 * stops at 50 rows is a wrong report, not a paginated one.
 */
const reportBase = rangeSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(5000).default(50),
  format: z.enum(['json', 'csv']).default('json'),
});

export const serviceReportSchema = reportBase.extend({
  status: z
    .enum(['requested', 'accepted', 'in_progress', 'completed', 'rejected', 'cancelled', 'disputed', 'refunded'])
    .optional(),
  categoryId: z.string().uuid().optional(),
  providerId: z.string().uuid().optional(),
  city: z.string().trim().min(1).max(120).optional(),
});

export const payoutReportSchema = reportBase.extend({
  status: z.enum(['pending', 'processing', 'paid', 'failed', 'on_hold']).optional(),
  providerId: z.string().uuid().optional(),
  method: z.enum(['manual', 'gateway']).optional(),
});

export const idParamSchema = z.object({ id: z.string().uuid('Invalid identifier') });

export default {
  rangeSchema, seriesSchema, topSchema, providerPerformanceSchema,
  settingSchemas, settingKeyParam, payoutListSchema, idParamSchema,
  markPaidSchema, markFailedSchema, serviceReportSchema, payoutReportSchema,
};

// ---------- people directory ----------

export const peopleListSchema = z.object({
  role: z.enum(['customer', 'provider', 'agency', 'admin']).optional(),
  status: z.enum(['active', 'suspended', 'deactivated']).optional(),
  verification: z
    .enum(['unsubmitted', 'pending', 'info_requested', 'approved', 'rejected', 'suspended'])
    .optional(),
  search: z.string().trim().min(1).max(80).optional(),
  format: z.enum(['json', 'csv']).default('json'),
  page: z.coerce.number().int().min(1).optional(),
  // A CSV is the whole filtered set rather than one screen of it, so it takes
  // a higher ceiling than the page size - with a ceiling all the same, because
  // an unbounded export is a way to take the database out over HTTP.
  limit: z.coerce.number().int().min(1).max(5000).optional(),
});

export const accountStatusSchema = z.object({
  status: z.enum(['active', 'suspended']),
  reason: z.string().trim().max(400).optional(),
});

export const userIdParamSchema = z.object({ id: z.string().uuid() });

// ---------- audit trail ----------

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
  // Free strings, because the values come from whatever the log already
  // holds. An enum here would hide entries written by a version of the code
  // that has since changed.
  action: z.string().trim().max(60).optional(),
  entityType: z.string().trim().max(40).optional(),
  adminId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  search: z.string().trim().max(120).optional(),
  format: z.enum(['json', 'csv']).optional(),
});

// ---------- mail server ----------

export const smtpSchema = z.object({
  enabled: z.boolean().default(false),
  host: z.string().trim().max(253).default(''),
  // The three ports a mail server realistically listens on, rather than any
  // number: this value becomes an outbound connection from your server, and
  // an open choice of port is a small port-scanning primitive.
  port: z.coerce.number().int().refine((p) => [25, 465, 587, 2525].includes(p), {
    message: 'Use port 587, 465, 25 or 2525',
  }).default(587),
  secure: z.boolean().default(false),
  username: z.string().trim().max(254).default(''),
  // Optional on purpose: left empty, the stored password is kept, so changing
  // a port does not mean re-typing a credential.
  password: z.string().max(512).optional(),
  fromName: z.string().trim().max(60).default('ServiceMitra'),
  fromEmail: z.union([z.string().trim().email(), z.literal('')]).default(''),
});

// ---------- backup ----------

/**
 * An allowlist, not a free string.
 *
 * The dataset name selects a query. Anything that is not one of these has no
 * business reaching the service, whatever the service would do with it.
 */
export const datasetParamSchema = z.object({
  name: z.enum(['people', 'bookings', 'payments', 'invoices', 'payouts', 'reviews']),
});

/**
 * A backup filename, matched rather than accepted.
 *
 * The service checks this again before touching the filesystem - this copy is
 * here so a malformed name is refused at the edge with a 422 and never reaches
 * code that joins it to a path.
 */
export const backupFileParamSchema = z.object({
  name: z.string().regex(
    /^servicemitra-\d{4}-\d{2}-\d{2}-\d{4}-(database\.sql\.gz|files\.tar\.gz)$/,
    'Not a backup filename',
  ),
});
