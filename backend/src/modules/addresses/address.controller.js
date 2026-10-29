import asyncHandler from '../../utils/asyncHandler.js';
import { ok, created } from '../../utils/apiResponse.js';
import * as service from './address.service.js';

export const list = asyncHandler(async (req, res) => ok(res, await service.list(req.user.id)));

export const create = asyncHandler(async (req, res) =>
  created(res, await service.create(req.user.id, req.body), 'Address saved'),
);

export const setDefault = asyncHandler(async (req, res) =>
  ok(res, await service.setDefault(req.params.id, req.user.id), 'Default address updated'),
);

export const remove = asyncHandler(async (req, res) =>
  ok(res, await service.remove(req.params.id, req.user.id), 'Address removed'),
);
