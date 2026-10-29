import asyncHandler from '../../utils/asyncHandler.js';
import { ok, paginated } from '../../utils/apiResponse.js';
import { q } from '../../middleware/validate.js';
import { getPagination } from '../../utils/pagination.js';
import * as categoryRepo from '../categories/category.repository.js';
import ApiError from '../../utils/ApiError.js';
import * as service from './discovery.service.js';

export const search = asyncHandler(async (req, res) => {
  const query = q(req);
  const { page, limit, offset } = getPagination(query, { defaultLimit: 20, maxLimit: 50 });

  // A slug is friendlier in a shareable URL than a uuid.
  let categoryId = query.categoryId;
  if (!categoryId && query.categorySlug) {
    const category = await categoryRepo.findBySlug(query.categorySlug);
    if (!category) throw ApiError.notFound('Service category "' + query.categorySlug + '" not found');
    categoryId = category.id;
  }

  const result = await service.searchProviders({
    ...query,
    categoryId,
    search: query.q,
    page,
    limit,
    offset,
  });

  return paginated(res, result.items, {
    page,
    limit,
    total: result.total,
    message: result.total === 0 ? 'No providers match these filters yet' : 'OK',
  });
});

export const profile = asyncHandler(async (req, res) =>
  ok(res, await service.getPublicProfile(req.params.id, { days: q(req).days, minutes: q(req).minutes })),
);

export const featured = asyncHandler(async (req, res) => {
  const { limit, city } = q(req);
  return ok(res, await service.featured({ limit, city }));
});

export const suggest = asyncHandler(async (req, res) => {
  const { q: term, limit } = q(req);
  return ok(res, await service.suggest(term, limit));
});

export default { search, profile, featured, suggest };
