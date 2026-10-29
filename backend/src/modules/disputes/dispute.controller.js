import asyncHandler from '../../utils/asyncHandler.js';
import { ok, created, paginated } from '../../utils/apiResponse.js';
import { q } from '../../middleware/validate.js';
import { getPagination } from '../../utils/pagination.js';
import { record, AUDIT } from '../../services/audit.service.js';
import * as service from './dispute.service.js';

const actor = (req) => ({
  type: req.user.role,
  id: req.user.id,
  providerId: req.user.providerId ?? null,
});

export const raise = asyncHandler(async (req, res) =>
  created(res, await service.raise(req.body.bookingId, actor(req), req.body),
    'Dispute raised. Our team will review it and get back to you.'),
);

export const detail = asyncHandler(async (req, res) =>
  ok(res, await service.getDispute(req.params.id, actor(req))),
);

export const list = asyncHandler(async (req, res) => {
  const query = q(req);
  const { page, limit, offset } = getPagination(query);
  const result = await service.listDisputes({ ...query, limit, offset }, actor(req));
  return paginated(res, result.items, { page, limit, total: result.total });
});

export const message = asyncHandler(async (req, res) =>
  created(res, await service.addMessage(req.params.id, actor(req), req.body), 'Message added'),
);

export const counts = asyncHandler(async (_req, res) => ok(res, await service.counts()));

export const assign = asyncHandler(async (req, res) =>
  ok(res, await service.assign(req.params.id, req.user.id), { message: 'Dispute assigned to you' }),
);

export const resolve = asyncHandler(async (req, res) => {
  const result = await service.resolve(req.params.id, req.user.id, req.body);

  await record(req, {
    action: AUDIT.DISPUTE_RESOLVED,
    entityType: 'dispute',
    entityId: req.params.id,
    after: {
      resolutionType: req.body.resolutionType,
      refundAmountMinor: result.refund ? result.refund.amountMinor : null,
      bookingStatus: result.bookingStatus,
    },
    reason: req.body.resolution,
  });

  return ok(res, result, { message: 'Dispute resolved' });
});

export const reject = asyncHandler(async (req, res) => {
  const result = await service.reject(req.params.id, req.user.id, req.body);

  await record(req, {
    action: AUDIT.DISPUTE_RESOLVED,
    entityType: 'dispute',
    entityId: req.params.id,
    after: { resolutionType: 'rejected' },
    reason: req.body.resolution,
  });

  return ok(res, result, { message: 'Dispute closed without a refund' });
});

export default { raise, detail, list, message, counts, assign, resolve, reject };
