/**
 * Agencies.
 *
 * An agency employs providers. It creates their accounts, carries the
 * verification they inherit, and watches their work - but it never takes a
 * booking and never touches their money. Each provider keeps their own
 * earnings ledger and their own bank details, exactly like an independent one.
 *
 * That separation is the whole design. It means discovery, booking, payments
 * and payouts needed no changes to support agencies, and it means an agency
 * cannot quietly divert what someone else earned.
 */
import bcrypt from 'bcryptjs';
import { withTransaction } from '../../db/pool.js';
import env from '../../config/env.js';
import ApiError from '../../utils/ApiError.js';
import { ROLES, VERIFICATION_STATUS } from '../../config/constants.js';
import { notifyAllAsync } from '../../services/notification.service.js';
import * as authRepo from '../auth/auth.repository.js';
import * as repo from './agency.repository.js';

function present(a) {
  return {
    id: a.id,
    name: a.name,
    headline: a.headline,
    about: a.about,
    registrationNo: a.registration_no,
    address: {
      line: a.address_line,
      city: a.city,
      state: a.state,
      pincode: a.pincode,
    },
    verificationStatus: a.verification_status,
    verifiedAt: a.verified_at,
    contactName: a.contact_name,
    email: a.email,
    phone: a.phone,
    createdAt: a.created_at,
  };
}

function presentProvider(p) {
  return {
    id: p.id,
    userId: p.user_id,
    name: p.full_name,
    email: p.email,
    phone: p.phone,
    headline: p.headline,
    verificationStatus: p.verification_status,
    isAcceptingBookings: p.is_accepting_bookings,
    accountStatus: p.account_status,
    isRemoved: p.is_removed,
    rating: Number(p.rating_average ?? 0),
    ratingCount: p.rating_count ?? 0,
    jobsCompleted: p.jobs_completed ?? 0,
    openJobs: p.open_jobs ?? 0,
    lastLoginAt: p.last_login_at,
    createdAt: p.created_at,
  };
}

/** The signed-in agency. Throws rather than returning null - every caller needs it. */
export async function getMine(userId) {
  const agency = await repo.findByUserId(userId);
  if (!agency) throw ApiError.forbidden('This account does not have an agency profile');
  return present(agency);
}

export async function updateMine(agencyId, payload) {
  const updated = await repo.update(agencyId, payload);
  if (!updated) throw ApiError.notFound('Agency not found');
  return present(updated);
}

export async function listProviders(agencyId) {
  const rows = await repo.listProviders(agencyId);
  return rows.map(presentProvider);
}

/**
 * Creates a provider employed by this agency.
 *
 * The agency sets the password, so the person can sign in straight away and
 * run their own jobs, prices and schedule. The account is an ordinary provider
 * in every respect except that it carries an agency_id and inherits the
 * agency's verification.
 */
export async function addProvider(agencyId, { fullName, email, phone, password, headline }) {
  const agency = await repo.findById(agencyId);
  if (!agency) throw ApiError.notFound('Agency not found');

  const existing = await authRepo.findByEmailOrPhone(email, phone);
  if (existing) {
    const field =
      existing.email && email && existing.email.toLowerCase() === email.toLowerCase()
        ? 'email address'
        : 'phone number';
    throw ApiError.conflict('Someone already has an account with this ' + field);
  }

  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);

  /**
   * Nobody starts verified.
   *
   * A person added to an approved agency used to be bookable immediately, on
   * the grounds that the agency vouched for them. They now submit their own
   * Aadhaar and photograph and wait for an admin, like everyone else: the
   * platform's promise to a customer is that it checked the person who turns
   * up, not the business that sent them.
   */
  const startingStatus = VERIFICATION_STATUS.UNSUBMITTED;

  const created = await withTransaction(async (tx) => {
    const user = await authRepo.createUser(tx, {
      role: ROLES.PROVIDER,
      fullName,
      email,
      phone,
      passwordHash,
    });

    /**
     * Contact details count as confirmed, because somebody accountable
     * confirmed them.
     *
     * Self-registration now requires a code before the account works at all,
     * which is what stops a stranger inventing an email and a phone number.
     * That reasoning does not transfer here: this account is being created by
     * a signed-in agency whose own KYC an admin has already approved, and who
     * answers for the people they add.
     *
     * Without this the person would be locked out of an account they cannot
     * re-register - the agency owns the record, not them.
     */
    await tx.query('UPDATE users SET email_verified_at = NOW() WHERE id = $1', [user.id]);

    const profile = await authRepo.createProviderProfile(tx, user.id, {
      agencyId,
      verificationStatus: startingStatus,
    });

    if (headline) {
      await tx.query('UPDATE provider_profiles SET headline = $2 WHERE id = $1', [profile.id, headline]);
    }

    return { user, profile };
  });

  notifyAllAsync({
    userId: created.user.id,
    eventType: 'agency.provider_added',
    title: agency.name + ' has set up your ServiceMitra account',
    body:
      'You can sign in with this email address and the password ' + agency.name +
      ' gave you. Upload your Aadhaar and a photograph to get verified - you ' +
      'can take bookings once an admin has approved them.',
    actionLabel: 'Get verified',
    actionPath: '/provider/verification',
    entityType: 'provider_profile',
    entityId: created.profile.id,
  });

  return {
    id: created.profile.id,
    userId: created.user.id,
    name: created.user.full_name,
    email: created.user.email,
    phone: created.user.phone,
    verificationStatus: created.profile.verification_status,
    // Always false on creation now: nobody is bookable until they have
    // uploaded their own documents and an admin has approved them.
    isBookable: false,
  };
}

/**
 * Suspends or restores one of the agency's providers.
 *
 * Suspension is on the user account rather than the profile, so it also stops
 * them signing in. Their bookings, ledger and history stay exactly as they
 * were - this is an employment decision, not a data deletion.
 */
export async function setProviderStatus(agencyId, providerId, { status, reason }) {
  const provider = await repo.findProvider(agencyId, providerId);
  if (!provider) throw ApiError.notFound('This provider is not part of your agency');

  if (status === 'suspended' && provider.account_status === 'suspended') {
    throw ApiError.conflict('This provider is already suspended');
  }

  await withTransaction(async (tx) => {
    await tx.query('UPDATE users SET status = $2::account_status WHERE id = $1', [
      provider.user_id,
      status,
    ]);

    // A suspended provider must stop appearing in search immediately, not at
    // the next time they happen to toggle their own availability.
    if (status === 'suspended') {
      await tx.query(
        'UPDATE provider_profiles SET is_accepting_bookings = FALSE WHERE id = $1',
        [providerId],
      );
    }
  });

  notifyAllAsync({
    userId: provider.user_id,
    eventType: status === 'suspended' ? 'agency.provider_suspended' : 'agency.provider_restored',
    title:
      status === 'suspended'
        ? 'Your account has been suspended by your agency'
        : 'Your account has been restored',
    body:
      status === 'suspended'
        ? 'You cannot take new bookings for now.' + (reason ? ' Reason: ' + reason : '')
        : 'You can sign in and take bookings again.',
    entityType: 'provider_profile',
    entityId: providerId,
  });

  return { id: providerId, accountStatus: status };
}

export async function listBookings(agencyId, filters) {
  const { items, total } = await repo.listBookings(agencyId, filters);

  return {
    items: items.map((b) => ({
      id: b.id,
      reference: b.reference,
      status: b.status,
      service: b.category_name,
      providerName: b.provider_name,
      customerName: b.customer_name,
      city: b.address_city,
      scheduledStart: b.scheduled_start,
      amountMinor: Number(b.final_amount_minor ?? b.quoted_amount_minor ?? 0),
      createdAt: b.created_at,
    })),
    total,
  };
}

export async function overview(agencyId) {
  const [agency, stats] = await Promise.all([repo.findById(agencyId), repo.overview(agencyId)]);
  if (!agency) throw ApiError.notFound('Agency not found');

  return {
    agency: { id: agency.id, name: agency.name, verificationStatus: agency.verification_status },
    providers: stats.providers,
    approvedProviders: stats.approved_providers,
    onlineProviders: stats.online_providers,
    totalJobs: stats.total_jobs,
    openJobs: stats.open_jobs,
    completedJobs: stats.completed_jobs,
    averageRating: Number(stats.avg_rating),
    // The one thing an unapproved agency needs to be told on every screen.
    canOperate: agency.verification_status === VERIFICATION_STATUS.APPROVED,
  };
}

export default {
  getMine, updateMine, listProviders, addProvider, setProviderStatus,
  listBookings, overview,
};
