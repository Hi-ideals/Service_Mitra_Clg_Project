import { withTransaction } from '../../db/pool.js';
import ApiError from '../../utils/ApiError.js';
import { ROLES } from '../../config/constants.js';
import { notifyAllAsync } from '../../services/notification.service.js';
import * as repo from './people.repository.js';

/**
 * One row of the people directory.
 *
 * `verification` collapses the two profile tables into the single answer an
 * admin is looking for: has this person been checked. A customer has no
 * verification to report, so it is null rather than invented.
 */
function present(r) {
  const verification =
    r.role === ROLES.PROVIDER
      ? r.provider_verification
      : r.role === ROLES.AGENCY
        ? r.agency_verification
        : null;

  return {
    id: r.id,
    role: r.role,
    name: r.full_name,
    email: r.email,
    phone: r.phone,
    status: r.status,
    verification,
    isVerified: verification === 'approved',
    contactVerified: Boolean(r.email_verified_at || r.phone_verified_at),
    createdAt: r.created_at,

    // Role-specific, null where it does not apply rather than zero - a
    // customer with "0 jobs" reads as a provider who has done none.
    businessName: r.business_name ?? r.agency_name ?? null,
    jobsCompleted: r.role === ROLES.PROVIDER ? (r.jobs_completed ?? 0) : null,
    isAcceptingBookings: r.role === ROLES.PROVIDER ? r.is_accepting_bookings : null,
    employer: r.employer_name ?? null,
  };
}

export async function summary() {
  const s = await repo.summary();

  return {
    total: s.total,
    customers: s.customers,
    admins: s.admins,
    suspended: s.suspended,
    providers: {
      total: s.providers,
      verified: s.verified_providers,
      pending: s.pending_providers,
    },
    agencies: {
      total: s.agencies,
      verified: s.verified_agencies,
      pending: s.pending_agencies,
    },
  };
}

export async function list(query, window) {
  const [rows, total] = await Promise.all([repo.list(query, window), repo.count(query)]);
  return { rows: rows.map(present), total };
}

/**
 * Suspends or restores an account.
 *
 * Admin accounts are out of scope entirely, not just your own. Only an admin
 * can reach this endpoint, so the only thing admin suspension can achieve is
 * admins locking each other - or themselves - out of the console that unlocks
 * accounts, which has no in-app way back. An admin who should lose access
 * loses it by having their role changed or their account removed, deliberately
 * and not from a list where every row carries the same red button.
 */
export async function setStatus(userId, { status, reason }, actingAdminId) {
  if (userId === actingAdminId) {
    throw ApiError.badRequest('You cannot change the status of your own account');
  }

  const existing = await repo.findUser(userId);
  if (!existing) throw ApiError.notFound('That account does not exist');

  if (existing.role === ROLES.ADMIN) {
    throw ApiError.badRequest('Admin accounts cannot be suspended from here');
  }

  if (existing.status === status) {
    return { ...present({ ...existing, full_name: existing.full_name }), unchanged: true };
  }

  const updated = await withTransaction((tx) => repo.setStatus(tx, userId, status));

  notifyAllAsync({
    userId,
    eventType: status === 'suspended' ? 'account.suspended' : 'account.restored',
    title: status === 'suspended' ? 'Your account has been suspended' : 'Your account is active again',
    body:
      status === 'suspended'
        ? 'You cannot sign in while your account is suspended.' +
          (reason ? ' Reason: ' + reason : '') +
          ' Contact support if you think this is a mistake.'
        : 'You can sign in again. Welcome back.',
    entityType: 'user',
    entityId: userId,
  });

  return {
    id: updated.id,
    role: updated.role,
    name: updated.full_name,
    status: updated.status,
  };
}

export const PEOPLE_COLUMNS = [
  { header: 'Name', value: (r) => r.name },
  { header: 'Role', value: (r) => r.role },
  { header: 'Business', value: (r) => r.businessName ?? '' },
  { header: 'Email', value: (r) => r.email ?? '' },
  { header: 'Phone', value: (r) => r.phone ?? '' },
  { header: 'Account status', value: (r) => r.status },
  { header: 'Verification', value: (r) => r.verification ?? '' },
  { header: 'Accepting bookings', value: (r) => (r.isAcceptingBookings === null ? '' : r.isAcceptingBookings ? 'yes' : 'no') },
  { header: 'Jobs done', value: (r) => (r.jobsCompleted === null ? '' : r.jobsCompleted) },
  { header: 'Works for', value: (r) => r.employer ?? '' },
  { header: 'Joined', value: (r) => (r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '') },
];

export default { summary, list, setStatus, PEOPLE_COLUMNS };
