/**
 * Provider self-service endpoints. Every handler acts on req.user.providerId,
 * so a provider can only ever read or change their own profile - there is no
 * path where an id from the request body selects whose profile is edited.
 */
import asyncHandler from '../../utils/asyncHandler.js';
import { ok, created } from '../../utils/apiResponse.js';
import ApiError from '../../utils/ApiError.js';
import * as service from './provider.service.js';

/** Resolves the caller's own provider profile id. */
function myProviderId(req) {
  if (!req.user?.providerId) {
    throw ApiError.forbidden('This account does not have a service provider profile');
  }
  return req.user.providerId;
}

export const getMyProfile = asyncHandler(async (req, res) =>
  ok(res, await service.getMyProfile(myProviderId(req))),
);

export const updateMyProfile = asyncHandler(async (req, res) =>
  ok(res, await service.updateProfile(myProviderId(req), req.body), { message: 'Profile updated' }),
);

export const getPayoutMethod = asyncHandler(async (req, res) =>
  ok(res, await service.getPayoutMethod(myProviderId(req))),
);

export const setPayoutMethod = asyncHandler(async (req, res) =>
  ok(res, await service.setPayoutMethod(myProviderId(req), req.body), {
    message: 'Payout details saved. Future payouts will be sent here.',
  }),
);

export const setStatus = asyncHandler(async (req, res) => {
  const result = await service.setAvailabilityStatus(myProviderId(req), req.body.isAcceptingBookings);
  return ok(res, result, {
    message: result.isAcceptingBookings ? 'You are now online and visible to customers' : 'You are now offline',
  });
});

// ---------- services ----------
export const listServices = asyncHandler(async (req, res) =>
  ok(res, await service.listServices(myProviderId(req))),
);

export const upsertService = asyncHandler(async (req, res) =>
  created(res, await service.upsertService(myProviderId(req), req.body), 'Service saved'),
);

export const removeService = asyncHandler(async (req, res) =>
  ok(res, await service.removeService(myProviderId(req), req.params.categoryId), {
    message: 'Service removed',
  }),
);

// ---------- service areas ----------
export const listAreas = asyncHandler(async (req, res) =>
  ok(res, await service.listAreas(myProviderId(req))),
);

export const addArea = asyncHandler(async (req, res) =>
  created(res, await service.addArea(myProviderId(req), req.body), 'Service area added'),
);

export const updateArea = asyncHandler(async (req, res) =>
  ok(res, await service.updateArea(myProviderId(req), req.params.id, req.body), {
    message: 'Service area updated',
  }),
);

export const removeArea = asyncHandler(async (req, res) =>
  ok(res, await service.removeArea(myProviderId(req), req.params.id), { message: 'Service area removed' }),
);

// ---------- availability ----------
export const getSchedule = asyncHandler(async (req, res) =>
  ok(res, await service.getSchedule(myProviderId(req))),
);

export const addWindow = asyncHandler(async (req, res) =>
  created(res, await service.addWindow(myProviderId(req), req.body), 'Working hours added'),
);

export const replaceSchedule = asyncHandler(async (req, res) =>
  ok(res, await service.replaceSchedule(myProviderId(req), req.body.windows), {
    message: 'Weekly schedule saved',
  }),
);

export const removeWindow = asyncHandler(async (req, res) =>
  ok(res, await service.removeWindow(myProviderId(req), req.params.id), { message: 'Working hours removed' }),
);

export const setException = asyncHandler(async (req, res) =>
  created(res, await service.setException(myProviderId(req), req.body), 'Calendar exception saved'),
);

export const removeException = asyncHandler(async (req, res) =>
  ok(res, await service.removeException(myProviderId(req), req.params.id), {
    message: 'Calendar exception removed',
  }),
);

export default {
  getMyProfile, updateMyProfile, setStatus, getPayoutMethod, setPayoutMethod,
  listServices, upsertService, removeService,
  listAreas, addArea, updateArea, removeArea,
  getSchedule, addWindow, replaceSchedule, removeWindow, setException, removeException,
};
