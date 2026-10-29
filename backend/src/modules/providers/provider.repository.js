/** Data access for the provider profile domain. */
import { query, queryOne, queryMany } from '../../db/pool.js';

const PROFILE = `
  p.id, p.user_id, p.business_name, p.headline, p.bio, p.experience_years,
  p.languages, p.skills, p.verification_status, p.verified_at,
  p.is_accepting_bookings, p.rating_average, p.rating_count, p.jobs_completed,
  p.jobs_cancelled, p.acceptance_rate, p.avg_response_minutes,
  p.slot_buffer_minutes, p.created_at, p.updated_at
`;

const USER = 'u.full_name, u.avatar_url, u.phone, u.email, u.status AS account_status';

export function findByUserId(userId) {
  return queryOne(
    `SELECT ${PROFILE}, ${USER}
       FROM provider_profiles p
       JOIN users u ON u.id = p.user_id
      WHERE p.user_id = $1 AND p.deleted_at IS NULL`,
    [userId],
  );
}

export function findById(id) {
  return queryOne(
    `SELECT ${PROFILE}, ${USER}
       FROM provider_profiles p
       JOIN users u ON u.id = p.user_id
      WHERE p.id = $1 AND p.deleted_at IS NULL`,
    [id],
  );
}

export function updateProfile(providerId, d) {
  return queryOne(
    `UPDATE provider_profiles SET
       business_name = COALESCE($2, business_name),
       headline = COALESCE($3, headline),
       bio = COALESCE($4, bio),
       experience_years = COALESCE($5, experience_years),
       languages = COALESCE($6, languages),
       skills = COALESCE($7, skills),
       slot_buffer_minutes = COALESCE($8, slot_buffer_minutes)
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING ${PROFILE.replaceAll('p.', '')}`,
    [
      providerId, d.businessName ?? null, d.headline ?? null, d.bio ?? null,
      d.experienceYears ?? null, d.languages ?? null, d.skills ?? null,
      d.slotBufferMinutes ?? null,
    ],
  );
}

export function setAcceptingBookings(providerId, accepting) {
  return queryOne(
    `UPDATE provider_profiles SET is_accepting_bookings = $2
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id, is_accepting_bookings, verification_status`,
    [providerId, accepting],
  );
}

// ---------- services offered ----------

export function listServices(providerId) {
  return queryMany(
    `SELECT pc.id, pc.category_id, pc.price_minor, pc.pricing_unit,
            pc.visit_charge_minor, pc.is_active,
            c.name AS category_name, c.slug AS category_slug,
            c.min_price_minor, c.max_price_minor, c.requires_certification
       FROM provider_categories pc
       JOIN service_categories c ON c.id = pc.category_id
      WHERE pc.provider_id = $1 AND c.deleted_at IS NULL
      ORDER BY c.display_order, c.name`,
    [providerId],
  );
}

export function findService(providerId, categoryId) {
  return queryOne(
    'SELECT id FROM provider_categories WHERE provider_id = $1 AND category_id = $2',
    [providerId, categoryId],
  );
}

export function upsertService(providerId, d) {
  return queryOne(
    `INSERT INTO provider_categories
       (provider_id, category_id, price_minor, pricing_unit, visit_charge_minor, is_active)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (provider_id, category_id) DO UPDATE SET
       price_minor = EXCLUDED.price_minor,
       pricing_unit = EXCLUDED.pricing_unit,
       visit_charge_minor = EXCLUDED.visit_charge_minor,
       is_active = EXCLUDED.is_active
     RETURNING id, category_id, price_minor, pricing_unit, visit_charge_minor, is_active`,
    // Visit charge withdrawn from the product: always stored as zero.
    [providerId, d.categoryId, d.priceMinor, d.pricingUnit, 0, d.isActive],
  );
}

export function removeService(providerId, categoryId) {
  return queryOne(
    'DELETE FROM provider_categories WHERE provider_id = $1 AND category_id = $2 RETURNING id',
    [providerId, categoryId],
  );
}

/** Live bookings block removal of the service they were booked under. */
export function activeBookingsForCategory(providerId, categoryId) {
  return queryOne(
    `SELECT COUNT(*)::int AS count FROM bookings
      WHERE provider_id = $1 AND category_id = $2
        AND status IN ('requested','accepted','in_progress')`,
    [providerId, categoryId],
  );
}

export default {
  findByUserId, findById, updateProfile, setAcceptingBookings,
  listServices, findService, upsertService, removeService, activeBookingsForCategory,
};

// ---------- service areas ----------

export function listAreas(providerId) {
  return queryMany(
    `SELECT id, city, state, pincodes, center_lat, center_lng, radius_km, is_active
       FROM provider_service_areas
      WHERE provider_id = $1
      ORDER BY created_at`,
    [providerId],
  );
}

export function createArea(providerId, d) {
  return queryOne(
    `INSERT INTO provider_service_areas
       (provider_id, city, state, pincodes, center_lat, center_lng, radius_km, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, city, state, pincodes, center_lat, center_lng, radius_km, is_active`,
    [providerId, d.city, d.state, d.pincodes, d.centerLat, d.centerLng, d.radiusKm, d.isActive],
  );
}

export function updateArea(providerId, areaId, d) {
  return queryOne(
    `UPDATE provider_service_areas SET
       city = COALESCE($3, city),
       state = COALESCE($4, state),
       pincodes = COALESCE($5, pincodes),
       center_lat = COALESCE($6, center_lat),
       center_lng = COALESCE($7, center_lng),
       radius_km = COALESCE($8, radius_km),
       is_active = COALESCE($9, is_active)
     WHERE id = $2 AND provider_id = $1
     RETURNING id, city, state, pincodes, center_lat, center_lng, radius_km, is_active`,
    [providerId, areaId, d.city ?? null, d.state ?? null, d.pincodes ?? null,
     d.centerLat ?? null, d.centerLng ?? null, d.radiusKm ?? null, d.isActive ?? null],
  );
}

export function removeArea(providerId, areaId) {
  return queryOne(
    'DELETE FROM provider_service_areas WHERE id = $2 AND provider_id = $1 RETURNING id',
    [providerId, areaId],
  );
}

// ---------- weekly availability ----------

export function listAvailability(providerId) {
  return queryMany(
    `SELECT id, day_of_week, start_time, end_time, is_active
       FROM provider_availability
      WHERE provider_id = $1
      ORDER BY day_of_week, start_time`,
    [providerId],
  );
}

/** Detects an overlap with an existing window on the same day. */
export function overlappingWindow(providerId, dayOfWeek, startTime, endTime, excludeId = null) {
  return queryOne(
    `SELECT id, start_time, end_time FROM provider_availability
      WHERE provider_id = $1 AND day_of_week = $2 AND is_active
        AND ($5::uuid IS NULL OR id <> $5)
        AND start_time < $4::time AND end_time > $3::time
      LIMIT 1`,
    [providerId, dayOfWeek, startTime, endTime, excludeId],
  );
}

export function createWindow(providerId, d) {
  return queryOne(
    `INSERT INTO provider_availability (provider_id, day_of_week, start_time, end_time, is_active)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, day_of_week, start_time, end_time, is_active`,
    [providerId, d.dayOfWeek, d.startTime, d.endTime, d.isActive],
  );
}

export function removeWindow(providerId, windowId) {
  return queryOne(
    'DELETE FROM provider_availability WHERE id = $2 AND provider_id = $1 RETURNING id',
    [providerId, windowId],
  );
}

export function replaceAvailability(tx, providerId, windows) {
  return tx.query('DELETE FROM provider_availability WHERE provider_id = $1', [providerId]).then(() =>
    Promise.all(
      windows.map((w) =>
        tx.one(
          `INSERT INTO provider_availability (provider_id, day_of_week, start_time, end_time, is_active)
           VALUES ($1,$2,$3,$4,TRUE)
           RETURNING id, day_of_week, start_time, end_time, is_active`,
          [providerId, w.dayOfWeek, w.startTime, w.endTime],
        ),
      ),
    ),
  );
}

// ---------- date exceptions ----------

export function listExceptions(providerId, fromDate) {
  return queryMany(
    `SELECT id, exception_date, is_available, start_time, end_time, reason
       FROM availability_exceptions
      WHERE provider_id = $1 AND exception_date >= $2::date
      ORDER BY exception_date`,
    [providerId, fromDate],
  );
}

export function upsertException(providerId, d) {
  return queryOne(
    `INSERT INTO availability_exceptions
       (provider_id, exception_date, is_available, start_time, end_time, reason)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (provider_id, exception_date) DO UPDATE SET
       is_available = EXCLUDED.is_available,
       start_time = EXCLUDED.start_time,
       end_time = EXCLUDED.end_time,
       reason = EXCLUDED.reason
     RETURNING id, exception_date, is_available, start_time, end_time, reason`,
    [providerId, d.date, d.isAvailable, d.startTime, d.endTime, d.reason],
  );
}

export function removeException(providerId, exceptionId) {
  return queryOne(
    'DELETE FROM availability_exceptions WHERE id = $2 AND provider_id = $1 RETURNING id',
    [providerId, exceptionId],
  );
}

/** Bookings already committed inside a window the provider wants to remove. */
export function bookingsInDateRange(providerId, fromDate, toDate) {
  return queryMany(
    `SELECT id, reference, scheduled_start FROM bookings
      WHERE provider_id = $1
        AND status IN ('requested','accepted','in_progress')
        AND scheduled_start >= $2::timestamptz AND scheduled_start < $3::timestamptz`,
    [providerId, fromDate, toDate],
  );
}
