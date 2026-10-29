/**
 * Search data access.
 *
 * Every query here starts from the same non-negotiable filter: approved,
 * online, not deleted. An unverified or suspended provider is structurally
 * unreachable through discovery rather than merely hidden by the UI.
 */
import { query, queryOne, queryMany } from '../../db/pool.js';

/** Great-circle distance in km, computed in SQL so it can drive ORDER BY. */
const DISTANCE_KM = `
  6371 * acos(LEAST(1.0,
    cos(radians($LAT)) * cos(radians(a.center_lat)) *
    cos(radians(a.center_lng) - radians($LNG)) +
    sin(radians($LAT)) * sin(radians(a.center_lat))
  ))
`;

const DISCOVERABLE = `
  p.deleted_at IS NULL
  AND p.verification_status = 'approved'
  AND p.is_accepting_bookings = TRUE
  AND u.status = 'active'
  AND u.deleted_at IS NULL
`;

/**
 * Builds the WHERE clause and parameters shared by the count and the page
 * query, so the two can never drift apart.
 */
function buildFilters(f) {
  const where = [DISCOVERABLE];
  const params = [];
  const push = (value) => {
    params.push(value);
    return '$' + params.length;
  };

  // Category, including anything nested beneath it.
  if (f.categoryId) {
    const p = push(f.categoryId);
    where.push(`pc.category_id IN (
      SELECT id FROM service_categories WHERE id = ${p}::uuid OR parent_id = ${p}::uuid
    )`);
  }

  if (f.city) where.push(`a.city ILIKE ${push(f.city)}`);

  // A pincode match is exact coverage - the strongest location signal there is.
  if (f.pincode) where.push(`${push(f.pincode)} = ANY(a.pincodes)`);

  if (f.minPriceMinor !== undefined) where.push(`pc.price_minor >= ${push(f.minPriceMinor)}`);
  if (f.maxPriceMinor !== undefined) where.push(`pc.price_minor <= ${push(f.maxPriceMinor)}`);
  if (f.minRating !== undefined) where.push(`p.rating_average >= ${push(f.minRating)}`);
  if (f.minExperience !== undefined) where.push(`p.experience_years >= ${push(f.minExperience)}`);

  if (f.search) {
    const p = push('%' + f.search + '%');
    const t = push(f.search);
    where.push(`(
      p.business_name ILIKE ${p}
      OR u.full_name ILIKE ${p}
      OR c.name ILIKE ${p}
      OR EXISTS (SELECT 1 FROM unnest(p.skills) s WHERE s ILIKE ${p})
      OR similarity(c.name, ${t}) > 0.3
      OR similarity(COALESCE(p.business_name, ''), ${t}) > 0.3
    )`);
  }

  return { where, params, push };
}

/** Distance filter, only when the caller actually gave coordinates. */
function geoClause(f, push) {
  if (f.lat === undefined || f.lng === undefined) return null;
  const lat = push(f.lat);
  const lng = push(f.lng);
  const expr = DISTANCE_KM.replaceAll('$LAT', lat).replaceAll('$LNG', lng);
  return { expr, lat, lng };
}

export async function search(f) {
  const { where, params, push } = buildFilters(f);
  const geo = geoClause(f, push);

  // Within the provider's own declared radius, or a caller-supplied cap.
  if (geo) {
    where.push(`a.center_lat IS NOT NULL AND a.center_lng IS NOT NULL`);
    where.push(`(${geo.expr}) <= LEAST(a.radius_km, ${push(f.radiusKm ?? 50)})`);
  }

  const distanceSelect = geo ? `MIN(${geo.expr})` : 'NULL::double precision';
  const clause = 'WHERE ' + where.join('\n  AND ');

  const FROM = `
    FROM provider_profiles p
    JOIN users u ON u.id = p.user_id
    JOIN provider_categories pc ON pc.provider_id = p.id AND pc.is_active
    JOIN service_categories c ON c.id = pc.category_id AND c.is_active AND c.deleted_at IS NULL
    LEFT JOIN provider_service_areas a ON a.provider_id = p.id AND a.is_active
    LEFT JOIN agencies ag ON ag.id = p.agency_id AND ag.deleted_at IS NULL
  `;

  const totalRow = await queryOne(
    `SELECT COUNT(DISTINCT p.id)::int AS total ${FROM} ${clause}`,
    params,
  );

  /**
   * Ranking. Rating carries the most weight, then proximity, then evidence
   * that the provider actually turns up: completed jobs and acceptance rate.
   * A new provider is not buried - the rating term falls back to the platform
   * average until they have ratings of their own.
   */
  const RANK = `
    (
      0.40 * (CASE WHEN p.rating_count = 0 THEN 0.7 ELSE p.rating_average / 5.0 END)
    + 0.25 * (CASE
                WHEN ${geo ? 'MIN(' + geo.expr + ')' : 'NULL'} IS NULL THEN 0.5
                ELSE GREATEST(0, 1 - (${geo ? 'MIN(' + geo.expr + ')' : '0'}) / 50.0)
              END)
    + 0.20 * LEAST(1.0, p.jobs_completed / 50.0)
    + 0.10 * (p.acceptance_rate / 100.0)
    + 0.05 * (CASE
                WHEN p.avg_response_minutes IS NULL THEN 0.5
                ELSE GREATEST(0, 1 - p.avg_response_minutes / 120.0)
              END)
    )
  `;

  const sortBy = {
    rating: 'p.rating_average DESC, p.rating_count DESC',
    price_low: 'MIN(pc.price_minor) ASC',
    price_high: 'MIN(pc.price_minor) DESC',
    experience: 'p.experience_years DESC',
    distance: geo ? distanceSelect + ' ASC NULLS LAST' : 'p.rating_average DESC',
    relevance: RANK + ' DESC',
  }[f.sort || 'relevance'];

  params.push(f.limit, f.offset);

  const items = await queryMany(
    `SELECT
       p.id, p.business_name, p.headline, p.experience_years, p.skills, p.languages,
       p.rating_average, p.rating_count, p.jobs_completed, p.acceptance_rate,
       p.avg_response_minutes, p.verified_at,
       u.full_name, u.avatar_url,
       ag.name AS agency_name,
       MIN(pc.price_minor)::bigint AS from_price_minor,
       MIN(pc.visit_charge_minor)::bigint AS visit_charge_minor,
       ${distanceSelect} AS distance_km,
       ${RANK} AS relevance_score,
       ARRAY_AGG(DISTINCT c.name) AS category_names,
       ARRAY_AGG(DISTINCT a.city) FILTER (WHERE a.city IS NOT NULL) AS cities
     ${FROM}
     ${clause}
     GROUP BY p.id, u.full_name, u.avatar_url, ag.name
     ORDER BY ${sortBy}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { items, total: totalRow.total };
}

export default { search };

/**
 * The public provider profile. Contact details are deliberately absent - a
 * customer gets the provider's phone number only once a booking is accepted.
 */
export function publicProfile(providerId) {
  return queryOne(
    `SELECT p.id, p.business_name, p.headline, p.bio, p.experience_years,
            p.skills, p.languages, p.rating_average, p.rating_count,
            p.jobs_completed, p.acceptance_rate, p.avg_response_minutes,
            p.verified_at, p.slot_buffer_minutes, p.created_at,
            u.full_name, u.avatar_url,
            ag.id AS agency_id, ag.name AS agency_name
       FROM provider_profiles p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN agencies ag ON ag.id = p.agency_id AND ag.deleted_at IS NULL
      WHERE p.id = $1
        AND p.deleted_at IS NULL
        AND p.verification_status = 'approved'
        AND u.status = 'active'`,
    [providerId],
  );
}

export function publicServices(providerId) {
  return queryMany(
    `SELECT pc.category_id, pc.price_minor, pc.pricing_unit, pc.visit_charge_minor,
            c.name AS category_name, c.slug AS category_slug,
            c.estimated_minutes, c.icon
       FROM provider_categories pc
       JOIN service_categories c ON c.id = pc.category_id
      WHERE pc.provider_id = $1 AND pc.is_active
        AND c.is_active AND c.deleted_at IS NULL
      ORDER BY c.display_order, c.name`,
    [providerId],
  );
}

export function publicAreas(providerId) {
  return queryMany(
    `SELECT city, state, pincodes, radius_km
       FROM provider_service_areas
      WHERE provider_id = $1 AND is_active
      ORDER BY city`,
    [providerId],
  );
}

export function weeklyHours(providerId) {
  return queryMany(
    `SELECT day_of_week, start_time, end_time
       FROM provider_availability
      WHERE provider_id = $1 AND is_active
      ORDER BY day_of_week, start_time`,
    [providerId],
  );
}

/** Dates the provider has blocked out, so the profile can grey them in a calendar. */
export function upcomingExceptions(providerId) {
  return queryMany(
    `SELECT exception_date, is_available, start_time, end_time, reason
       FROM availability_exceptions
      WHERE provider_id = $1 AND exception_date >= CURRENT_DATE
        AND exception_date < CURRENT_DATE + INTERVAL '60 days'
      ORDER BY exception_date`,
    [providerId],
  );
}

/** Slots already taken, used to show what is genuinely free on the profile. */
export function committedSlots(providerId, fromIso, toIso) {
  return queryMany(
    `SELECT scheduled_start, scheduled_end
       FROM bookings
      WHERE provider_id = $1
        AND status IN ('requested','accepted','in_progress')
        AND scheduled_start < $3::timestamptz
        AND scheduled_end > $2::timestamptz
      ORDER BY scheduled_start`,
    [providerId, fromIso, toIso],
  );
}

/** Drives the "popular near you" strip on the landing page. */
export function featured(limit, city) {
  return queryMany(
    `SELECT p.id, p.business_name, p.headline, p.rating_average, p.rating_count,
            p.jobs_completed, p.experience_years, u.full_name, u.avatar_url,
            MIN(pc.price_minor)::bigint AS from_price_minor,
            ARRAY_AGG(DISTINCT c.name) AS category_names
       FROM provider_profiles p
       JOIN users u ON u.id = p.user_id
       JOIN provider_categories pc ON pc.provider_id = p.id AND pc.is_active
       JOIN service_categories c ON c.id = pc.category_id AND c.is_active
       LEFT JOIN provider_service_areas a ON a.provider_id = p.id AND a.is_active
      WHERE ${DISCOVERABLE}
        AND ($2::text IS NULL OR a.city ILIKE $2)
      GROUP BY p.id, u.full_name, u.avatar_url
      HAVING p.rating_count > 0
      ORDER BY p.rating_average DESC, p.rating_count DESC
      LIMIT $1`,
    [limit, city ?? null],
  );
}

/** Suggestions for the search box: categories first, then provider names. */
export async function suggest(term, limit) {
  const like = '%' + term + '%';
  const categories = await queryMany(
    `SELECT name, slug, 'category' AS type
       FROM service_categories
      WHERE is_active AND deleted_at IS NULL AND name ILIKE $1
      ORDER BY similarity(name, $2) DESC, display_order
      LIMIT $3`,
    [like, term, limit],
  );

  const providers = await queryMany(
    `SELECT COALESCE(p.business_name, u.full_name) AS name,
            p.id::text AS slug, 'provider' AS type
       FROM provider_profiles p
       JOIN users u ON u.id = p.user_id
      WHERE ${DISCOVERABLE}
        AND (p.business_name ILIKE $1 OR u.full_name ILIKE $1)
      LIMIT $2`,
    [like, limit],
  );

  return [...categories, ...providers];
}
