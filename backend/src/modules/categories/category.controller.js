import asyncHandler from '../../utils/asyncHandler.js';
import { ok, created } from '../../utils/apiResponse.js';
import { q } from '../../middleware/validate.js';
import { record, AUDIT } from '../../services/audit.service.js';
import * as service from './category.service.js';

export const list = asyncHandler(async (req, res) => {
  const { rootOnly, parentId, includeInactive, search } = q(req);
  const data = await service.listCategories({
    parentId: rootOnly ? null : parentId,
    // Only an admin may see switched-off categories.
    includeInactive: includeInactive && req.user?.role === 'admin',
    search,
  });
  return ok(res, data, { meta: { count: data.length } });
});

export const tree = asyncHandler(async (req, res) => {
  const data = await service.getTree({
    includeInactive: q(req).includeInactive && req.user?.role === 'admin',
  });
  return ok(res, data, { meta: { count: data.length } });
});

export const detail = asyncHandler(async (req, res) =>
  ok(res, await service.getCategory(req.params.idOrSlug)),
);

export const create = asyncHandler(async (req, res) => {
  const category = await service.createCategory(req.body);
  await record(req, {
    action: AUDIT.CATEGORY_CREATED,
    entityType: 'service_category',
    entityId: category.id,
    after: category,
  });
  return created(res, category, 'Service category created');
});

export const update = asyncHandler(async (req, res) => {
  const { before, after } = await service.updateCategory(req.params.id, req.body);
  await record(req, {
    action: AUDIT.CATEGORY_UPDATED,
    entityType: 'service_category',
    entityId: after.id,
    before,
    after,
  });
  return ok(res, after, { message: 'Service category updated' });
});

export const uploadImage = asyncHandler(async (req, res) => {
  const { before, after } = await service.setCategoryImage(req.params.id, req.file);
  await record(req, {
    action: AUDIT.CATEGORY_UPDATED,
    entityType: 'service_category',
    entityId: after.id,
    before: { imageUrl: before.imageUrl },
    after: { imageUrl: after.imageUrl },
  });
  return ok(res, after, { message: 'Category photo updated' });
});

export const remove = asyncHandler(async (req, res) => {
  const result = await service.removeCategory(req.params.id);
  await record(req, {
    action: result.deleted ? AUDIT.CATEGORY_DELETED : AUDIT.CATEGORY_DEACTIVATED,
    entityType: 'service_category',
    entityId: req.params.id,
    before: result.category,
    reason: result.reason ?? null,
  });
  return ok(res, result, {
    message: result.deleted ? 'Service category removed' : 'Service category deactivated',
  });
});

export default { list, tree, detail, create, update, uploadImage, remove };
