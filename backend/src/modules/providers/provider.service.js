/**
 * Provider profile business logic.
 *
 * Two rules here carry most of the weight. A provider's price must sit inside
 * the admin's pricing band for that category, and a provider cannot switch
 * themselves live until KYC is approved and they actually have a service, an
 * area and some hours - otherwise they would appear in search with nothing
 * bookable behind them.
 */
import { withTransaction, queryOne } from '../../db/pool.js';
import ApiError from '../../utils/ApiError.js';
import { money, dateKey } from '../../utils/helpers.js';
import { VERIFICATION_STATUS } from '../../config/constants.js';
import * as repo from './provider.repository.js';
import * as categoryRepo from '../categories/category.repository.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function presentProfile(p) {
  return {
    id: p.id,
    userId: p.user_id,
    fullName: p.full_name,
    avatarUrl: p.avatar_url,
    businessName: p.business_name,
    headline: p.headline,
    bio: p.bio,
    experienceYears: p.experience_years,
    languages: p.languages ?? [],
    skills: p.skills ?? [],
    verificationStatus: p.verification_status,
    verifiedAt: p.verified_at,
    isAcceptingBookings: p.is_accepting_bookings,
    isDiscoverable:
      p.verification_status === VERIFICATION_STATUS.APPROVED && p.is_accepting_bookings,
    reputation: {
      ratingAverage: Number(p.rating_average),
      ratingCount: p.rating_count,
      jobsCompleted: p.jobs_completed,
      jobsCancelled: p.jobs_cancelled,
      acceptanceRate: Number(p.acceptance_rate),
      avgResponseMinutes: p.avg_response_minutes,
    },
    slotBufferMinutes: p.slot_buffer_minutes,
    createdAt: p.created_at,
  };
}

function presentService(s) {
  return {
    id: s.id,
    categoryId: s.category_id,
    categoryName: s.category_name,
    categorySlug: s.category_slug,
    priceMinor: s.price_minor,
    price: money.toMajor(s.price_minor),
    pricingUnit: s.pricing_unit,
    visitChargeMinor: s.visit_charge_minor,
    visitCharge: money.toMajor(s.visit_charge_minor),
    isActive: s.is_active,
    guideline: {
      minMinor: s.min_price_minor,
      maxMinor: s.max_price_minor,
      min: money.toMajor(s.min_price_minor),
      max: s.max_price_minor === null ? null : money.toMajor(s.max_price_minor),
    },
  };
}

const presentArea = (a) => ({
  id: a.id,
  city: a.city,
  state: a.state,
  pincodes: a.pincodes ?? [],
  centerLat: a.center_lat,
  centerLng: a.center_lng,
  radiusKm: Number(a.radius_km),
  isActive: a.is_active,
});

const presentWindow = (w) => ({
  id: w.id,
  dayOfWeek: w.day_of_week,
  day: DAYS[w.day_of_week],
  startTime: String(w.start_time).slice(0, 5),
  endTime: String(w.end_time).slice(0, 5),
  isActive: w.is_active,
});

const presentException = (e) => ({
  id: e.id,
  date: dateKey(e.exception_date),
  isAvailable: e.is_available,
  startTime: e.start_time ? String(e.start_time).slice(0, 5) : null,
  endTime: e.end_time ? String(e.end_time).slice(0, 5) : null,
  reason: e.reason,
});

/** Resolves the caller's provider profile, or fails cleanly if there is none. */
async function requireProfile(providerId) {
  const profile = await repo.findById(providerId);
  if (!profile) throw ApiError.notFound('Provider profile not found');
  return profile;
}

export async function getMyProfile(providerId) {
  const [profile, services, areas, availability] = await Promise.all([
    requireProfile(providerId),
    repo.listServices(providerId),
    repo.listAreas(providerId),
    repo.listAvailability(providerId),
  ]);

  const readiness = assessReadiness(profile, services, areas, availability);

  return {
    ...presentProfile(profile),
    services: services.map(presentService),
    serviceAreas: areas.map(presentArea),
    availability: availability.map(presentWindow),
    readiness,
  };
}

/**
 * What still stands between this provider and being bookable. The provider
 * dashboard renders this as a checklist.
 */
function assessReadiness(profile, services, areas, availability) {
  const steps = [
    { key: 'profile', label: 'Add your headline and experience', done: Boolean(profile.headline) },
    { key: 'services', label: 'Add at least one service with a price', done: services.some((s) => s.is_active) },
    { key: 'area', label: 'Define where you work', done: areas.some((a) => a.is_active) },
    { key: 'availability', label: 'Set your weekly working hours', done: availability.some((a) => a.is_active) },
    {
      key: 'verification',
      label: 'Get your KYC approved',
      done: profile.verification_status === VERIFICATION_STATUS.APPROVED,
    },
  ];

  const pending = steps.filter((s) => !s.done);
  return {
    steps,
    complete: pending.length === 0,
    canGoLive: pending.length === 0,
    percentComplete: Math.round(((steps.length - pending.length) / steps.length) * 100),
  };
}

export async function updateProfile(providerId, payload) {
  await requireProfile(providerId);
  const updated = await repo.updateProfile(providerId, payload);
  return presentProfile({ ...updated, full_name: undefined });
}

/**
 * The provider's own online switch. Separate from admin verification: a
 * verified provider may still go offline, but an unverified one can never go
 * online.
 */
/**
 * Where this provider wants to be paid.
 *
 * Returned to the provider with the account number intact - it is their own -
 * but never widened beyond that. The admin queue reads it through the payout
 * service, which decides separately what an admin may see.
 */
export async function getPayoutMethod(providerId) {
  const row = await queryOne(
    `SELECT payout_method, payout_upi_id, payout_account_name, payout_account_number,
            payout_ifsc, payout_bank_name, payout_updated_at
       FROM provider_profiles WHERE id = $1`,
    [providerId],
  );

  if (!row) throw ApiError.notFound('Provider profile not found');

  return {
    method: row.payout_method,
    upiId: row.payout_upi_id,
    accountName: row.payout_account_name,
    accountNumber: row.payout_account_number,
    ifsc: row.payout_ifsc,
    bankName: row.payout_bank_name,
    updatedAt: row.payout_updated_at,
    isComplete: Boolean(row.payout_method),
  };
}

/**
 * Replaces the payout destinations wholesale rather than patching fields.
 *
 * A provider may hold both a UPI id and a bank account - UPI for the quick
 * ones, bank for the large ones - and `preferred` says which the payout queue
 * uses. Holding both is the point; the queue still pays to exactly one.
 *
 * Still wholesale, though. Whatever arrives is the complete picture: a block
 * that is absent is cleared, which is how a provider removes a destination
 * they no longer want. Patching field by field is how a stale half-destination
 * survives a change, and a half-destination is exactly how money reaches the
 * wrong place.
 */
export async function setPayoutMethod(providerId, payload) {
  const { preferred, upi, bank } = payload;

  // One column, two possible sources. The bank block wins because the name on
  // a bank account has to match it exactly, while on UPI it is decoration.
  const accountName = bank?.accountName ?? upi?.accountName ?? null;

  const row = await queryOne(
    `UPDATE provider_profiles
        SET payout_method = $2,
            payout_upi_id = $3,
            payout_account_name = $4,
            payout_account_number = $5,
            payout_ifsc = $6,
            payout_bank_name = $7,
            payout_updated_at = NOW()
      WHERE id = $1
      RETURNING id`,
    [
      providerId,
      preferred,
      upi?.upiId ?? null,
      accountName,
      bank?.accountNumber ?? null,
      bank?.ifsc ? bank.ifsc.toUpperCase() : null,
      bank?.bankName ?? null,
    ],
  );

  if (!row) throw ApiError.notFound('Provider profile not found');
  return getPayoutMethod(providerId);
}

export async function setAvailabilityStatus(providerId, accepting) {
  const profile = await requireProfile(providerId);

  if (accepting) {
    if (profile.verification_status !== VERIFICATION_STATUS.APPROVED) {
      throw new ApiError(403, 'Your account must be verified before you can accept bookings', {
        code: 'PROVIDER_NOT_VERIFIED',
        details: { status: profile.verification_status },
      });
    }

    const [services, areas, availability] = await Promise.all([
      repo.listServices(providerId),
      repo.listAreas(providerId),
      repo.listAvailability(providerId),
    ]);

    const readiness = assessReadiness(profile, services, areas, availability);
    if (!readiness.canGoLive) {
      throw new ApiError(400, 'Finish setting up your profile before going online', {
        code: 'PROFILE_INCOMPLETE',
        details: { pending: readiness.steps.filter((s) => !s.done).map((s) => s.label) },
      });
    }
  }

  const row = await repo.setAcceptingBookings(providerId, accepting);
  return {
    isAcceptingBookings: row.is_accepting_bookings,
    isDiscoverable: row.is_accepting_bookings && row.verification_status === VERIFICATION_STATUS.APPROVED,
  };
}

// ---------------------------------------------------------------- services offered

export async function listServices(providerId) {
  const rows = await repo.listServices(providerId);
  return rows.map(presentService);
}

/**
 * Adds or re-prices a service. The price must sit inside the admin's band for
 * that category - the guideline is a rule, not a suggestion, because it is
 * what stops the marketplace being undercut or gouged.
 */
export async function upsertService(providerId, payload) {
  await requireProfile(providerId);

  const category = await categoryRepo.findById(payload.categoryId);
  if (!category) throw ApiError.badRequest('That service category does not exist');
  if (!category.is_active) throw ApiError.badRequest('That service category is not currently available');

  if (payload.priceMinor < category.min_price_minor) {
    throw ApiError.badRequest(
      'Your price is below the minimum of ' + money.format(category.min_price_minor) +
        ' set for ' + category.name,
    );
  }

  if (category.max_price_minor !== null && payload.priceMinor > category.max_price_minor) {
    throw ApiError.badRequest(
      'Your price is above the maximum of ' + money.format(category.max_price_minor) +
        ' set for ' + category.name,
    );
  }

  await repo.upsertService(providerId, {
    ...payload,
    pricingUnit: payload.pricingUnit ?? category.pricing_unit,
  });

  const rows = await repo.listServices(providerId);
  const saved = rows.find((r) => r.category_id === payload.categoryId);
  return presentService(saved);
}

export async function removeService(providerId, categoryId) {
  await requireProfile(providerId);

  const { count } = await repo.activeBookingsForCategory(providerId, categoryId);
  if (count > 0) {
    throw ApiError.conflict(
      'You have ' + count + ' live booking(s) for this service. Complete or cancel them first.',
    );
  }

  const removed = await repo.removeService(providerId, categoryId);
  if (!removed) throw ApiError.notFound('You do not offer that service');
  return { removed: true, categoryId };
}

// ---------------------------------------------------------------- service areas

export async function listAreas(providerId) {
  return (await repo.listAreas(providerId)).map(presentArea);
}

export async function addArea(providerId, payload) {
  await requireProfile(providerId);
  const existing = await repo.listAreas(providerId);

  // More than a handful of areas usually means the provider is not actually
  // able to serve them, which degrades search quality for everyone.
  if (existing.length >= 10) {
    throw ApiError.badRequest('You can define at most 10 service areas');
  }

  const row = await repo.createArea(providerId, payload);
  return presentArea(row);
}

export async function updateArea(providerId, areaId, payload) {
  const row = await repo.updateArea(providerId, areaId, payload);
  if (!row) throw ApiError.notFound('Service area not found');
  return presentArea(row);
}

export async function removeArea(providerId, areaId) {
  const areas = await repo.listAreas(providerId);
  if (areas.length === 1 && areas[0].id === areaId) {
    const profile = await requireProfile(providerId);
    if (profile.is_accepting_bookings) {
      throw ApiError.conflict(
        'This is your only service area. Go offline first, or add another area before removing it.',
      );
    }
  }

  const removed = await repo.removeArea(providerId, areaId);
  if (!removed) throw ApiError.notFound('Service area not found');
  return { removed: true, id: areaId };
}

// ---------------------------------------------------------------- availability

export async function getSchedule(providerId) {
  const [windows, exceptions] = await Promise.all([
    repo.listAvailability(providerId),
    repo.listExceptions(providerId, dateKey(new Date())),
  ]);

  // Grouped by day, which is how the provider dashboard renders it.
  const byDay = DAYS.map((day, index) => ({
    dayOfWeek: index,
    day,
    windows: windows.filter((w) => w.day_of_week === index).map(presentWindow),
  }));

  return { week: byDay, exceptions: exceptions.map(presentException) };
}

export async function addWindow(providerId, payload) {
  await requireProfile(providerId);

  const clash = await repo.overlappingWindow(
    providerId, payload.dayOfWeek, payload.startTime, payload.endTime,
  );

  if (clash) {
    throw ApiError.conflict(
      'This overlaps an existing window on ' + DAYS[payload.dayOfWeek] + ' (' +
        String(clash.start_time).slice(0, 5) + ' to ' + String(clash.end_time).slice(0, 5) + ')',
    );
  }

  return presentWindow(await repo.createWindow(providerId, payload));
}

/** Replaces the whole week in one transaction - how the dashboard saves. */
export async function replaceSchedule(providerId, windows) {
  await requireProfile(providerId);

  for (const w of windows) {
    const sameDay = windows.filter((o) => o.dayOfWeek === w.dayOfWeek);
    const overlap = sameDay.some((o) => o !== w && o.startTime < w.endTime && o.endTime > w.startTime);
    if (overlap) {
      throw ApiError.badRequest('Two windows on ' + DAYS[w.dayOfWeek] + ' overlap each other');
    }
  }

  const saved = await withTransaction((tx) => repo.replaceAvailability(tx, providerId, windows));
  return saved.map(presentWindow);
}

export async function removeWindow(providerId, windowId) {
  const removed = await repo.removeWindow(providerId, windowId);
  if (!removed) throw ApiError.notFound('Availability window not found');
  return { removed: true, id: windowId };
}

/**
 * A one-off deviation - a holiday or extra hours. Blocking a date that already
 * has live bookings is refused, because the customers have been promised that
 * slot.
 */
export async function setException(providerId, payload) {
  await requireProfile(providerId);

  if (!payload.isAvailable) {
    const dayStart = payload.date + 'T00:00:00Z';
    const dayEnd = payload.date + 'T23:59:59Z';
    const booked = await repo.bookingsInDateRange(providerId, dayStart, dayEnd);

    if (booked.length) {
      throw ApiError.conflict(
        'You have ' + booked.length + ' booking(s) on ' + payload.date +
          '. Reschedule or cancel them before blocking this date.',
      );
    }
  }

  return presentException(await repo.upsertException(providerId, payload));
}

export async function removeException(providerId, exceptionId) {
  const removed = await repo.removeException(providerId, exceptionId);
  if (!removed) throw ApiError.notFound('Availability exception not found');
  return { removed: true, id: exceptionId };
}

export { presentProfile, presentService, presentArea };
