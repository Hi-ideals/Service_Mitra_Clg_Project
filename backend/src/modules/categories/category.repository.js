/** Data access for the catalogue domain. */
import { query, queryOne, queryMany } from '../../db/pool.js';

const COLUMNS = `
  id, parent_id, name, slug, description, icon, image_url,
  base_price_minor, min_price_minor, max_price_minor, pricing_unit,
  estimated_minutes, commission_percent, requires_certification,
  is_active, display_order, created_at, updated_at
`;

export function findById(id) {
  return queryOne(
    `SELECT ${COLUMNS} FROM service_categories WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
}

export function findBySlug(slug) {
  return queryOne(
    `SELECT ${COLUMNS} FROM service_categories WHERE slug = $1 AND deleted_at IS NULL`,
    [slug],
  );
}

export function slugExists(slug, excludeId = null) {
  return queryOne(
    `SELECT id FROM service_categories
      WHERE slug = $1 AND deleted_at IS NULL AND ($2::uuid IS NULL OR id <> $2)`,
    [slug, excludeId],
  );
}

/**
 * Lists categories. `includeInactive` is admin-only - customers must never see
 * a category the platform has switched off.
 */
export function list({ parentId = undefined, includeInactive = false, search = null }) {
  const where = ['deleted_at IS NULL'];
  const params = [];

  if (!includeInactive) where.push('is_active = TRUE');

  if (parentId !== undefined) {
    if (parentId === null) {
      where.push('parent_id IS NULL');
    } else {
      params.push(parentId);
      where.push(`parent_id = $${params.length}`);
    }
  }

  if (search) {
    params.push(`%${search}%`);
    where.push(`(name ILIKE $${params.length} OR description ILIKE $${params.length})`);
  }

  return queryMany(
    `SELECT ${COLUMNS} FROM service_categories
      WHERE ${where.join(' AND ')}
      ORDER BY display_order, name`,
    params,
  );
}

/**
 * The whole tree in one round trip, with a live provider count per category.
 *
 * The count covers the category and its children, counted distinctly. A parent
 * like Electrical has no providers attached to it directly - they attach to
 * Wiring, Lighting and so on - so counting the row alone would show zero, and
 * summing the children in JavaScript counted anyone offering two of them
 * twice. Three electricians offering two services each read as six on the
 * home page while search, which counts people, found three.
 *
 * One level of nesting is all the catalogue has, and all the tree builder
 * assembles.
 */
export function listTree({ includeInactive = false } = {}) {
  return queryMany(
    `SELECT c.${COLUMNS.trim().split(/,\s*/).join(', c.')},
            COUNT(DISTINCT pc.provider_id) FILTER (
              WHERE pc.is_active AND p.verification_status = 'approved'
                AND p.is_accepting_bookings AND p.deleted_at IS NULL
            )::int AS provider_count
       FROM service_categories c
       LEFT JOIN service_categories child
              ON child.parent_id = c.id AND child.deleted_at IS NULL
       LEFT JOIN provider_categories pc
              ON pc.category_id = c.id OR pc.category_id = child.id
       LEFT JOIN provider_profiles p ON p.id = pc.provider_id
      WHERE c.deleted_at IS NULL ${includeInactive ? '' : 'AND c.is_active = TRUE'}
      GROUP BY c.id
      ORDER BY c.display_order, c.name`,
  );
}

export function create(data) {
  return queryOne(
    `INSERT INTO service_categories
       (parent_id, name, slug, description, icon, image_url, base_price_minor,
        min_price_minor, max_price_minor, pricing_unit, estimated_minutes,
        commission_percent, requires_certification, display_order, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING ${COLUMNS}`,
    [
      data.parentId, data.name, data.slug, data.description, data.icon, data.imageUrl,
      data.basePriceMinor, data.minPriceMinor, data.maxPriceMinor, data.pricingUnit,
      data.estimatedMinutes, data.commissionPercent, data.requiresCertification,
      data.displayOrder, data.isActive,
    ],
  );
}

export function update(id, data) {
  return queryOne(
    `UPDATE service_categories SET
       name = COALESCE($2, name),
       slug = COALESCE($3, slug),
       description = COALESCE($4, description),
       icon = COALESCE($5, icon),
       image_url = COALESCE($6, image_url),
       base_price_minor = COALESCE($7, base_price_minor),
       min_price_minor = COALESCE($8, min_price_minor),
       max_price_minor = COALESCE($9, max_price_minor),
       pricing_unit = COALESCE($10, pricing_unit),
       estimated_minutes = COALESCE($11, estimated_minutes),
       commission_percent = COALESCE($12, commission_percent),
       requires_certification = COALESCE($13, requires_certification),
       display_order = COALESCE($14, display_order),
       is_active = COALESCE($15, is_active)
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING ${COLUMNS}`,
    [
      id, data.name, data.slug, data.description, data.icon, data.imageUrl,
      data.basePriceMinor, data.minPriceMinor, data.maxPriceMinor, data.pricingUnit,
      data.estimatedMinutes, data.commissionPercent, data.requiresCertification,
      data.displayOrder, data.isActive,
    ],
  );
}

export function setImage(id, imageUrl) {
  return queryOne(
    `UPDATE service_categories SET image_url = $2
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING ${COLUMNS}`,
    [id, imageUrl],
  );
}

/**
 * The slug is released as the row is deleted. It is UNIQUE across every row,
 * deleted or not, so keeping it would stop the admin creating a new
 * "Plumbing" after removing the old one.
 */
export function softDelete(id) {
  return queryOne(
    `UPDATE service_categories
        SET deleted_at = NOW(), is_active = FALSE,
            slug = slug || '--deleted-' || replace(id::text, '-', '')
      WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id],
  );
}

/** Usage counts that decide whether a category may be removed at all. */
export async function usage(id) {
  return queryOne(
    `SELECT
       (SELECT COUNT(*)::int FROM service_categories WHERE parent_id = $1 AND deleted_at IS NULL) AS children,
       (SELECT COUNT(*)::int FROM provider_categories WHERE category_id = $1) AS providers,
       (SELECT COUNT(*)::int FROM bookings WHERE category_id = $1) AS bookings`,
    [id],
  );
}

export default {
  findById, findBySlug, slugExists, list, listTree, create, update, setImage, softDelete, usage,
};
