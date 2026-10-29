import asyncHandler from '../../utils/asyncHandler.js';
import { ok, created, paginated } from '../../utils/apiResponse.js';
import ApiError from '../../utils/ApiError.js';
import { q } from '../../middleware/validate.js';
import { getPagination } from '../../utils/pagination.js';
import * as service from './agency.service.js';

/**
 * The agency acting in this request.
 *
 * Read from the authenticated session, never from the URL or the body. Every
 * query downstream is scoped by this value, so there is no request shape that
 * lets one agency name another.
 */
function myAgencyId(req) {
  if (!req.user?.agencyId) {
    throw ApiError.forbidden('This account does not have an agency profile');
  }
  return req.user.agencyId;
}

export const getMine = asyncHandler(async (req, res) => ok(res, await service.getMine(req.user.id)));

export const updateMine = asyncHandler(async (req, res) =>
  ok(res, await service.updateMine(myAgencyId(req), req.body), { message: 'Agency profile updated' }),
);

export const overview = asyncHandler(async (req, res) =>
  ok(res, await service.overview(myAgencyId(req))),
);

export const listProviders = asyncHandler(async (req, res) =>
  ok(res, await service.listProviders(myAgencyId(req))),
);

export const addProvider = asyncHandler(async (req, res) => {
  const provider = await service.addProvider(myAgencyId(req), req.body);

  return created(
    res,
    provider,
    provider.isBookable
      ? provider.name + ' can sign in now and start taking bookings.'
      : provider.name + ' can sign in now. They become bookable once your agency is verified.',
  );
});

export const setProviderStatus = asyncHandler(async (req, res) => {
  const result = await service.setProviderStatus(myAgencyId(req), req.params.id, req.body);
  return ok(res, result, {
    message: result.accountStatus === 'suspended' ? 'Provider suspended' : 'Provider restored',
  });
});

export const listBookings = asyncHandler(async (req, res) => {
  const query = q(req);
  const { page, limit, offset } = getPagination(query);
  const result = await service.listBookings(myAgencyId(req), { ...query, limit, offset });
  return paginated(res, result.items, { page, limit, total: result.total });
});

export default {
  getMine, updateMine, overview, listProviders, addProvider, setProviderStatus, listBookings,
};
