/**
 * Catalogue business logic.
 *
 * The admin owns the catalogue and the pricing guidelines; providers price
 * themselves inside the band this module defines, and Payments reads the
 * commission override from here.
 */
import ApiError from '../../utils/ApiError.js';
import { money } from '../../utils/helpers.js';
import env from '../../config/env.js';
import { assertRealFile } from '../../middleware/upload.js';
import * as storage from '../../storage/storage.service.js';
import * as repo from './category.repository.js';

/** Presentation shape. Prices are exposed in both paise and rupees so the UI never does the maths. */
function present(c) {
  return {
    id: c.id,
    parentId: c.parent_id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    icon: c.icon,
    imageUrl: c.image_url,
    pricing: {
      baseMinor: c.base_price_minor,
      base: money.toMajor(c.base_price_minor),
      minMinor: c.min_price_minor,
      min: money.toMajor(c.min_price_minor),
      maxMinor: c.max_price_minor,
      max: c.max_price_minor === null ? null : money.toMajor(c.max_price_minor),
      unit: c.pricing_unit,
    },
    estimatedMinutes: c.estimated_minutes,
    commissionPercent: c.commission_percent,
    requiresCertification: c.requires_certification,
    isActive: c.is_active,
    displayOrder: c.display_order,
    ...(c.provider_count !== undefined ? { providerCount: c.provider_count } : {}),
  };
}

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

export async function listCategories({ parentId, includeInactive, search }) {
  const rows = await repo.list({ parentId, includeInactive, search });
  return rows.map(present);
}

/** Nests the flat list into parents with children, for the browse page. */
export async function getTree({ includeInactive = false } = {}) {
  const rows = (await repo.listTree({ includeInactive })).map(present);
  const byId = new Map(rows.map((r) => [r.id, { ...r, children: [] }]));

  const roots = [];
  for (const row of byId.values()) {
    if (row.parentId && byId.has(row.parentId)) {
      byId.get(row.parentId).children.push(row);
    } else if (!row.parentId) {
      roots.push(row);
    }
  }

  /**
   * The count comes from the query, which counts people distinctly across the
   * subtree.
   *
   * It used to be summed here instead, and summing counts a provider once per
   * service they offer: three electricians offering two services each read as
   * six on the home page, while search - which counts people - found three.
   * The same provider is one professional however much work they will take on.
   */
  return roots;
}

export async function getCategory(idOrSlug) {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
  const row = isUuid ? await repo.findById(idOrSlug) : await repo.findBySlug(idOrSlug);
  if (!row) throw ApiError.notFound('Service category not found');
  return present(row);
}

async function assertValidBand({ minPriceMinor, maxPriceMinor, basePriceMinor }) {
  if (maxPriceMinor !== null && maxPriceMinor !== undefined && maxPriceMinor < minPriceMinor) {
    throw ApiError.badRequest('The maximum price cannot be lower than the minimum price');
  }
  if (basePriceMinor < minPriceMinor) {
    throw ApiError.badRequest('The suggested base price cannot be below the minimum price');
  }
  if (maxPriceMinor !== null && maxPriceMinor !== undefined && basePriceMinor > maxPriceMinor) {
    throw ApiError.badRequest('The suggested base price cannot exceed the maximum price');
  }
}

export async function createCategory(payload) {
  const slug = payload.slug || slugify(payload.name);
  if (await repo.slugExists(slug)) {
    throw ApiError.conflict('A category with the slug "' + slug + '" already exists');
  }

  if (payload.parentId) {
    const parent = await repo.findById(payload.parentId);
    if (!parent) throw ApiError.badRequest('The parent category does not exist');
    if (parent.parent_id) {
      // Two levels is enough to navigate; deeper trees hurt discovery.
      throw ApiError.badRequest('Categories can only be nested one level deep');
    }
  }

  await assertValidBand(payload);
  const row = await repo.create({ ...payload, slug });
  return present(row);
}

export async function updateCategory(id, payload) {
  const existing = await repo.findById(id);
  if (!existing) throw ApiError.notFound('Service category not found');

  if (payload.slug && (await repo.slugExists(payload.slug, id))) {
    throw ApiError.conflict('A category with the slug "' + payload.slug + '" already exists');
  }

  await assertValidBand({
    minPriceMinor: payload.minPriceMinor ?? existing.min_price_minor,
    maxPriceMinor: payload.maxPriceMinor ?? existing.max_price_minor,
    basePriceMinor: payload.basePriceMinor ?? existing.base_price_minor,
  });

  const row = await repo.update(id, payload);
  return { before: present(existing), after: present(row) };
}

/** Where an uploaded photo is reachable from the browser - see app.js. */
const PUBLIC_PREFIX = env.API_PREFIX + '/static/';

/**
 * Sets the photo on a top-level category.
 *
 * Only parents carry one: they are the tiles on the home page, and a
 * subcategory is only ever shown as a line of text inside its parent.
 * The shared upload check also lets PDFs through for KYC, so images are
 * narrowed here.
 */
export async function setCategoryImage(id, file) {
  const existing = await repo.findById(id);
  if (!existing) throw ApiError.notFound('Service category not found');
  if (existing.parent_id) {
    throw ApiError.badRequest('Only a top-level category can have a photo');
  }

  assertRealFile(file);
  if (!file.mimetype.startsWith('image/')) {
    throw ApiError.badRequest('Upload a JPG, PNG or WEBP photo');
  }

  const key = storage.buildKey({ scope: 'categories', ownerId: id, originalName: file.originalname });
  await storage.put(key, file.buffer, { isPublic: true });

  const row = await repo.setImage(id, PUBLIC_PREFIX + key);

  // The old photo is unreachable once the row points elsewhere. Removing it is
  // housekeeping, so a failure here must not undo an upload that succeeded.
  if (existing.image_url?.startsWith(PUBLIC_PREFIX)) {
    await storage
      .remove(existing.image_url.slice(PUBLIC_PREFIX.length), { isPublic: true })
      .catch(() => {});
  }

  return { before: present(existing), after: present(row) };
}

/**
 * Removal is deliberately conservative. A category with history is never
 * deleted - it is deactivated, so existing bookings and invoices keep their
 * meaning while it disappears from discovery.
 */
export async function removeCategory(id) {
  const existing = await repo.findById(id);
  if (!existing) throw ApiError.notFound('Service category not found');

  const used = await repo.usage(id);

  if (used.children > 0) {
    throw ApiError.conflict(
      'This category has ' + used.children + ' sub-categories. Remove or reassign them first.',
    );
  }

  if (used.bookings > 0 || used.providers > 0) {
    const row = await repo.update(id, { isActive: false });
    return {
      deleted: false,
      deactivated: true,
      reason:
        'The category is in use by ' + used.providers + ' provider(s) and ' + used.bookings +
        ' booking(s), so it was deactivated instead of deleted to keep that history intact.',
      category: present(row),
    };
  }

  await repo.softDelete(id);
  return { deleted: true, deactivated: false, category: present(existing) };
}

export { present as presentCategory };

export default {
  listCategories, getTree, getCategory, createCategory, updateCategory, setCategoryImage,
  removeCategory,
};
