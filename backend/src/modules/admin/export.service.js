import { queryMany, queryOne } from '../../db/pool.js';
import ApiError from '../../utils/ApiError.js';
import { money } from '../../utils/helpers.js';

/**
 * On-demand data exports.
 *
 * This is not a backup of the server, and the screen that uses it says so. A
 * real backup is a scheduled `pg_dump` plus the uploads directory, written
 * somewhere other than this machine. What this gives an admin is the records
 * in a form a human or an accountant can read, for reconciliation, for a
 * regulator, or for carrying the business elsewhere.
 *
 * KYC documents are deliberately absent. They are files on disk, not rows, and
 * streaming Aadhaar scans through an HTTP response because somebody clicked a
 * button is not a thing this should make easy.
 */

const iso = (d) => (d ? new Date(d).toISOString() : '');
const date = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

/**
 * Every dataset, in one registry.
 *
 * Keeping the query and its columns together is what stops an export drifting
 * from its header row - a CSV whose columns no longer describe its data is
 * worse than no CSV, because it is believed.
 */
const DATASETS = {
  people: {
    label: 'People',
    description: 'Every account, with role, verification and contact details.',
    count: 'SELECT COUNT(*)::int AS n FROM users WHERE deleted_at IS NULL',
    rows: () =>
      queryMany(
        `SELECT u.full_name, u.role, u.email, u.phone, u.status, u.created_at,
                COALESCE(p.business_name, a.name) AS business,
                COALESCE(p.verification_status, a.verification_status)::text AS verification
           FROM users u
           LEFT JOIN provider_profiles p ON p.user_id = u.id AND p.deleted_at IS NULL
           LEFT JOIN agencies a ON a.user_id = u.id
          WHERE u.deleted_at IS NULL
          ORDER BY u.created_at`,
      ),
    columns: [
      { header: 'Name', value: (r) => r.full_name },
      { header: 'Role', value: (r) => r.role },
      { header: 'Business', value: (r) => r.business ?? '' },
      { header: 'Email', value: (r) => r.email ?? '' },
      { header: 'Phone', value: (r) => r.phone ?? '' },
      { header: 'Account status', value: (r) => r.status },
      { header: 'Verification', value: (r) => r.verification ?? '' },
      { header: 'Joined', value: (r) => date(r.created_at) },
    ],
  },

  bookings: {
    label: 'Bookings',
    description: 'Every booking with its services, parties, schedule and amounts.',
    count: 'SELECT COUNT(*)::int AS n FROM bookings',
    rows: () =>
      queryMany(
        `SELECT b.reference, b.status, b.scheduled_start, b.created_at, b.completed_at,
                b.quoted_amount_minor, b.final_amount_minor, b.commission_percent,
                b.address_city, b.address_pincode,
                cu.full_name AS customer,
                COALESCE(pp.business_name, pu.full_name) AS provider,
                COALESCE(
                  string_agg(DISTINCT sc.name, ' + ' ORDER BY sc.name),
                  headline.name
                ) AS services
           FROM bookings b
           JOIN users cu ON cu.id = b.customer_id
           JOIN provider_profiles pp ON pp.id = b.provider_id
           JOIN users pu ON pu.id = pp.user_id
           JOIN service_categories headline ON headline.id = b.category_id
           LEFT JOIN booking_items bi ON bi.booking_id = b.id
           LEFT JOIN service_categories sc ON sc.id = bi.category_id
          GROUP BY b.id, cu.full_name, pp.business_name, pu.full_name, headline.name
          ORDER BY b.created_at`,
      ),
    columns: [
      { header: 'Reference', value: (r) => r.reference },
      { header: 'Status', value: (r) => r.status },
      { header: 'Services', value: (r) => r.services ?? '' },
      { header: 'Customer', value: (r) => r.customer },
      { header: 'Provider', value: (r) => r.provider },
      { header: 'City', value: (r) => r.address_city ?? '' },
      { header: 'Pincode', value: (r) => r.address_pincode ?? '' },
      { header: 'Quoted', value: (r) => money.toMajor(r.quoted_amount_minor) },
      { header: 'Final', value: (r) => (r.final_amount_minor === null ? '' : money.toMajor(r.final_amount_minor)) },
      { header: 'Commission %', value: (r) => r.commission_percent },
      { header: 'Scheduled for', value: (r) => iso(r.scheduled_start) },
      { header: 'Booked at', value: (r) => iso(r.created_at) },
      { header: 'Completed at', value: (r) => iso(r.completed_at) },
    ],
  },

  payments: {
    label: 'Payments',
    description: 'Every payment attempt, settled or not, with its gateway reference.',
    count: 'SELECT COUNT(*)::int AS n FROM payments',
    rows: () =>
      queryMany(
        `SELECT pay.reference, pay.status, pay.amount_minor, pay.currency, pay.method,
                pay.gateway, pay.gateway_order_id, pay.gateway_payment_id,
                pay.created_at, pay.paid_at,
                b.reference AS booking_reference, cu.full_name AS customer
           FROM payments pay
           JOIN bookings b ON b.id = pay.booking_id
           JOIN users cu ON cu.id = pay.customer_id
          ORDER BY pay.created_at`,
      ),
    columns: [
      { header: 'Reference', value: (r) => r.reference },
      { header: 'Booking', value: (r) => r.booking_reference },
      { header: 'Customer', value: (r) => r.customer },
      { header: 'Status', value: (r) => r.status },
      { header: 'Amount', value: (r) => money.toMajor(r.amount_minor) },
      { header: 'Currency', value: (r) => r.currency },
      { header: 'Method', value: (r) => r.method ?? '' },
      { header: 'Gateway', value: (r) => r.gateway },
      { header: 'Gateway order', value: (r) => r.gateway_order_id ?? '' },
      { header: 'Gateway payment', value: (r) => r.gateway_payment_id ?? '' },
      { header: 'Created', value: (r) => iso(r.created_at) },
      { header: 'Paid', value: (r) => iso(r.paid_at) },
    ],
  },

  invoices: {
    label: 'Invoices',
    description: 'What each customer was billed, and how it split.',
    count: 'SELECT COUNT(*)::int AS n FROM invoices',
    rows: () =>
      queryMany(
        `SELECT i.invoice_number, i.service_amount_minor, i.visit_charge_minor,
                i.tax_amount_minor, i.discount_minor, i.total_amount_minor,
                i.commission_minor, i.provider_earning_minor, i.issued_at,
                b.reference AS booking_reference,
                cu.full_name AS customer,
                COALESCE(pp.business_name, pu.full_name) AS provider
           FROM invoices i
           JOIN bookings b ON b.id = i.booking_id
           JOIN users cu ON cu.id = i.customer_id
           JOIN provider_profiles pp ON pp.id = i.provider_id
           JOIN users pu ON pu.id = pp.user_id
          ORDER BY i.issued_at`,
      ),
    columns: [
      { header: 'Invoice', value: (r) => r.invoice_number },
      { header: 'Booking', value: (r) => r.booking_reference },
      { header: 'Customer', value: (r) => r.customer },
      { header: 'Provider', value: (r) => r.provider },
      { header: 'Services', value: (r) => money.toMajor(r.service_amount_minor) },
      { header: 'Visit charge', value: (r) => money.toMajor(r.visit_charge_minor) },
      { header: 'Tax', value: (r) => money.toMajor(r.tax_amount_minor) },
      { header: 'Discount', value: (r) => money.toMajor(r.discount_minor) },
      { header: 'Total', value: (r) => money.toMajor(r.total_amount_minor) },
      { header: 'Commission', value: (r) => money.toMajor(r.commission_minor) },
      { header: 'Provider earns', value: (r) => money.toMajor(r.provider_earning_minor) },
      { header: 'Issued', value: (r) => iso(r.issued_at) },
    ],
  },

  payouts: {
    label: 'Payouts',
    description: 'Money sent to providers, with the bank reference for each.',
    count: 'SELECT COUNT(*)::int AS n FROM payouts',
    rows: () =>
      queryMany(
        `SELECT po.reference, po.status, po.amount_minor, po.method,
                po.payment_reference, po.created_at, po.processed_at, po.failure_reason,
                COALESCE(pp.business_name, pu.full_name) AS provider
           FROM payouts po
           JOIN provider_profiles pp ON pp.id = po.provider_id
           JOIN users pu ON pu.id = pp.user_id
          ORDER BY po.created_at`,
      ),
    columns: [
      { header: 'Reference', value: (r) => r.reference },
      { header: 'Provider', value: (r) => r.provider },
      { header: 'Status', value: (r) => r.status },
      { header: 'Amount', value: (r) => money.toMajor(r.amount_minor) },
      { header: 'Method', value: (r) => r.method ?? '' },
      { header: 'Bank reference', value: (r) => r.payment_reference ?? '' },
      { header: 'Prepared', value: (r) => iso(r.created_at) },
      { header: 'Settled', value: (r) => iso(r.processed_at) },
      { header: 'Failure reason', value: (r) => r.failure_reason ?? '' },
    ],
  },

  reviews: {
    label: 'Reviews',
    description: 'What customers said, and which booking it was about.',
    count: 'SELECT COUNT(*)::int AS n FROM reviews',
    rows: () =>
      queryMany(
        `SELECT r.rating, r.title, r.comment, r.created_at,
                b.reference AS booking_reference,
                cu.full_name AS customer,
                COALESCE(pp.business_name, pu.full_name) AS provider
           FROM reviews r
           JOIN bookings b ON b.id = r.booking_id
           JOIN users cu ON cu.id = r.customer_id
           JOIN provider_profiles pp ON pp.id = r.provider_id
           JOIN users pu ON pu.id = pp.user_id
          ORDER BY r.created_at`,
      ),
    columns: [
      { header: 'Booking', value: (r) => r.booking_reference },
      { header: 'Provider', value: (r) => r.provider },
      { header: 'Customer', value: (r) => r.customer },
      { header: 'Rating', value: (r) => r.rating },
      { header: 'Title', value: (r) => r.title ?? '' },
      { header: 'Comment', value: (r) => r.comment ?? '' },
      { header: 'Written', value: (r) => iso(r.created_at) },
    ],
  },
};

export const DATASET_NAMES = Object.keys(DATASETS);

/** What there is to export, and how much of it. */
export async function summary() {
  const counts = await Promise.all(
    DATASET_NAMES.map(async (name) => {
      const row = await queryOne(DATASETS[name].count);
      return {
        name,
        label: DATASETS[name].label,
        description: DATASETS[name].description,
        rows: row?.n ?? 0,
      };
    }),
  );

  // Separate, because these are files rather than rows and this screen cannot
  // hand them over. Saying how many exist is what stops an admin believing the
  // export covers them.
  const documents = await queryOne('SELECT COUNT(*)::int AS n FROM kyc_documents');

  return { datasets: counts, kycDocuments: documents?.n ?? 0 };
}

export async function dataset(name) {
  const entry = DATASETS[name];
  if (!entry) throw ApiError.notFound('There is no "' + name + '" export');

  return { rows: await entry.rows(), columns: entry.columns, label: entry.label };
}

export default { summary, dataset, DATASET_NAMES };
