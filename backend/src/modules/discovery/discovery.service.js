/**
 * Discovery business logic.
 *
 * Turns a customer's need - a category, a location, a time - into a ranked
 * list of providers who can genuinely serve it. "Genuinely" is the operative
 * word: anyone unverified, offline or outside the customer's area is excluded
 * before ranking begins.
 */
import ApiError from '../../utils/ApiError.js';
import { money, dateKey } from '../../utils/helpers.js';
import * as repo from './discovery.repository.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * How often a visit may start.
 *
 * This is the spacing of the offered times, and it is deliberately not the
 * length of the job. Stepping by the job's own duration meant a two-hour
 * visit in a nine-hour day produced three times to choose from, and the times
 * themselves moved every time the customer ticked another service - the same
 * provider offering 09:00 and 11:30 for one job but 09:00 and 10:30 for
 * another is confusing, and it hides most of the day.
 *
 * Counted from the start of the provider's own window rather than from the
 * clock, so somebody who opens at 09:15 is offered 09:15 and not 10:15.
 *
 * On the hour, because that is how people arrange a tradesman coming round.
 * Raise or lower this one number to offer more or fewer times; nothing else
 * depends on it.
 */
const SLOT_GRID_MINUTES = 60;

function presentResult(r) {
  return {
    id: r.id,
    name: r.business_name || r.full_name,
    contactName: r.full_name,
    avatarUrl: r.avatar_url,
    headline: r.headline,
    experienceYears: r.experience_years,
    skills: r.skills ?? [],
    languages: r.languages ?? [],
    categories: (r.category_names ?? []).filter(Boolean),
    cities: (r.cities ?? []).filter(Boolean),
    rating: {
      average: Number(r.rating_average),
      count: r.rating_count,
      // Distinguishes "no ratings yet" from a genuine low score in the UI.
      isNew: r.rating_count === 0,
    },
    jobsCompleted: r.jobs_completed,
    acceptanceRate: Number(r.acceptance_rate),
    avgResponseMinutes: r.avg_response_minutes,
    fromPriceMinor: Number(r.from_price_minor),
    fromPrice: money.toMajor(r.from_price_minor),
    visitChargeMinor: Number(r.visit_charge_minor ?? 0),
    distanceKm: r.distance_km === null ? null : Number(Number(r.distance_km).toFixed(1)),
    verifiedAt: r.verified_at,
    relevanceScore:
      r.relevance_score === undefined ? undefined : Number(Number(r.relevance_score).toFixed(4)),
  };
}

export async function searchProviders(filters) {
  const { items, total } = await repo.search(filters);

  return {
    items: items.map(presentResult),
    total,
    appliedFilters: {
      categoryId: filters.categoryId ?? null,
      city: filters.city ?? null,
      pincode: filters.pincode ?? null,
      near:
        filters.lat === undefined
          ? null
          : { lat: filters.lat, lng: filters.lng, radiusKm: filters.radiusKm ?? 50 },
      priceRange: [filters.minPriceMinor ?? null, filters.maxPriceMinor ?? null],
      minRating: filters.minRating ?? null,
      sort: filters.sort ?? 'relevance',
    },
  };
}

/**
 * Expands the provider's weekly hours into concrete bookable slots, minus what
 * is already committed and any date they have blocked. This is what the
 * profile page's date picker renders, and what Phase 7 will validate against.
 */
function buildSlots({ hours, exceptions, booked, days, slotMinutes, bufferMinutes }) {
  const byDay = new Map();
  for (const h of hours) {
    if (!byDay.has(h.day_of_week)) byDay.set(h.day_of_week, []);
    byDay.get(h.day_of_week).push(h);
  }

  const exceptionByDate = new Map(exceptions.map((e) => [dateKey(e.exception_date), e]));

  const taken = booked.map((b) => ({
    start: new Date(b.scheduled_start).getTime(),
    end: new Date(b.scheduled_end).getTime(),
  }));

  const step = SLOT_GRID_MINUTES * 60000;
  const duration = slotMinutes * 60000;

  /**
   * Travel and clearing-up time, kept clear on either side of work already
   * committed. It used to be folded into the spacing above, which meant it
   * thinned out the whole day instead of protecting the gap around a job -
   * and a provider with nothing booked lost times for no reason at all.
   */
  const buffer = bufferMinutes * 60000;
  const now = Date.now();
  const out = [];

  for (let d = 0; d < days; d += 1) {
    const day = new Date();
    day.setDate(day.getDate() + d);
    const key = dateKey(day);
    const exception = exceptionByDate.get(key);

    // A blocked date wins over the weekly rule; an "extra hours" exception
    // replaces that day's windows entirely.
    if (exception && !exception.is_available) {
      out.push({
        date: key,
        day: DAYS[day.getDay()],
        blocked: true,
        reason: exception.reason ?? null,
        slots: [],
      });
      continue;
    }

    const windows =
      exception && exception.is_available
        ? [{ start_time: exception.start_time, end_time: exception.end_time }]
        : byDay.get(day.getDay()) ?? [];

    const slots = [];
    for (const w of windows) {
      const [sh, sm] = String(w.start_time).split(':').map(Number);
      const [eh, em] = String(w.end_time).split(':').map(Number);

      const windowStart = new Date(day);
      windowStart.setHours(sh, sm, 0, 0);
      const windowEnd = new Date(day);
      windowEnd.setHours(eh, em, 0, 0);

      for (let t = windowStart.getTime(); t + duration <= windowEnd.getTime(); t += step) {
        if (t < now) continue;
        if (taken.some((b) => t < b.end + buffer && t + duration > b.start - buffer)) continue;
        slots.push({
          start: new Date(t).toISOString(),
          end: new Date(t + duration).toISOString(),
        });
      }
    }

    out.push({ date: key, day: DAYS[day.getDay()], blocked: false, slots });
  }

  return out;
}

export async function getPublicProfile(providerId, { days = 7, minutes } = {}) {
  const profile = await repo.publicProfile(providerId);
  if (!profile) throw ApiError.notFound('This service provider is not available');

  const from = new Date().toISOString();
  const to = new Date(Date.now() + days * 86400000).toISOString();

  const [services, areas, hours, exceptions, booked] = await Promise.all([
    repo.publicServices(providerId),
    repo.publicAreas(providerId),
    repo.weeklyHours(providerId),
    repo.upcomingExceptions(providerId),
    repo.committedSlots(providerId, from, to),
  ]);

  const shortest = services.length
    ? services.reduce((min, s) => Math.min(min, s.estimated_minutes || 60), Infinity)
    : 60;

  /**
   * How long each offered slot has to be.
   *
   * Without `minutes` the grid is built at the provider's shortest service, so
   * a browsing customer sees the most times possible. Once they have chosen
   * what they want, the client sends the real total and the grid narrows to
   * the windows that can actually hold the visit - otherwise the booking flow
   * would offer a 09:00 slot and then refuse it three steps later.
   */
  const slotMinutes = minutes ?? (Number.isFinite(shortest) ? shortest : 60);

  const availability = buildSlots({
    hours,
    exceptions,
    booked,
    days,
    slotMinutes,
    bufferMinutes: profile.slot_buffer_minutes,
  });

  return {
    id: profile.id,
    name: profile.business_name || profile.full_name,
    contactName: profile.full_name,
    avatarUrl: profile.avatar_url,
    headline: profile.headline,
    bio: profile.bio,
    experienceYears: profile.experience_years,
    skills: profile.skills ?? [],
    languages: profile.languages ?? [],
    isVerified: true,
    verifiedAt: profile.verified_at,
    memberSince: profile.created_at,
    rating: {
      average: Number(profile.rating_average),
      count: profile.rating_count,
      isNew: profile.rating_count === 0,
    },
    jobsCompleted: profile.jobs_completed,
    acceptanceRate: Number(profile.acceptance_rate),
    avgResponseMinutes: profile.avg_response_minutes,
    services: services.map((s) => ({
      categoryId: s.category_id,
      categoryName: s.category_name,
      categorySlug: s.category_slug,
      icon: s.icon,
      priceMinor: s.price_minor,
      price: money.toMajor(s.price_minor),
      pricingUnit: s.pricing_unit,
      visitChargeMinor: s.visit_charge_minor,
      estimatedMinutes: s.estimated_minutes,
    })),
    serviceAreas: areas.map((a) => ({
      city: a.city,
      state: a.state,
      pincodes: a.pincodes ?? [],
      radiusKm: Number(a.radius_km),
    })),
    availability,
    nextAvailableSlot: availability.flatMap((d) => d.slots)[0] ?? null,
  };
}

export async function featured({ limit, city }) {
  return (await repo.featured(limit, city)).map(presentResult);
}

export async function suggest(term, limit) {
  return (await repo.suggest(term, limit)).map((r) => ({
    label: r.name,
    value: r.slug,
    type: r.type,
  }));
}

export default { searchProviders, getPublicProfile, featured, suggest };
