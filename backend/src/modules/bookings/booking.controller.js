import asyncHandler from '../../utils/asyncHandler.js';
import { ok, created, paginated } from '../../utils/apiResponse.js';
import ApiError from '../../utils/ApiError.js';
import { q } from '../../middleware/validate.js';
import { getPagination } from '../../utils/pagination.js';
import { record, AUDIT } from '../../services/audit.service.js';
import * as service from './booking.service.js';

/**
 * The acting identity, assembled from the token. Nothing here is taken from
 * the request body, so a caller cannot act as someone else.
 */
function actor(req) {
  return { type: req.user.role, id: req.user.id, providerId: req.user.providerId ?? null };
}

function requireProvider(req) {
  if (!req.user.providerId) throw ApiError.forbidden('This account has no provider profile');
  return req.user.providerId;
}

export const create = asyncHandler(async (req, res) =>
  created(res, await service.createBooking(req.user.id, req.body), 'Booking requested'),
);

export const list = asyncHandler(async (req, res) => {
  const query = q(req);
  const { page, limit, offset } = getPagination(query, { defaultLimit: 20, maxLimit: 50 });
  const result = await service.listBookings(actor(req), { ...query, limit, offset });
  return paginated(res, result.items, { page, limit, total: result.total });
});

export const counts = asyncHandler(async (req, res) => ok(res, await service.counts(actor(req))));

export const detail = asyncHandler(async (req, res) =>
  ok(res, await service.getBooking(req.params.id, actor(req))),
);

export const accept = asyncHandler(async (req, res) =>
  ok(res, await service.accept(req.params.id, requireProvider(req), req.user.id), {
    message: 'Booking accepted. The customer has been notified.',
  }),
);

export const reject = asyncHandler(async (req, res) =>
  ok(res, await service.reject(req.params.id, requireProvider(req), req.user.id, req.body.reason), {
    message: 'Booking declined',
  }),
);

export const cancellationQuote = asyncHandler(async (req, res) =>
  ok(res, await service.getCancellationQuote(req.params.id, actor(req))),
);

export const cancel = asyncHandler(async (req, res) => {
  const result = await service.cancel(req.params.id, actor(req), req.body.reason);

  if (req.user.role === 'admin') {
    await record(req, {
      action: AUDIT.BOOKING_CANCELLED,
      entityType: 'booking',
      entityId: req.params.id,
      reason: req.body.reason,
    });
  }

  return ok(res, result, {
    message: result.cancellation.feeMinor > 0
      ? 'Booking cancelled. ' + result.cancellation.reason
      : 'Booking cancelled at no charge',
  });
});

export const reschedule = asyncHandler(async (req, res) => {
  const result = await service.reschedule(req.params.id, actor(req), req.body);
  return ok(res, result, {
    message: result.requiresReconfirmation
      ? 'Booking moved. The provider needs to confirm the new time.'
      : 'Booking rescheduled',
  });
});

export default { create, list, counts, detail, accept, reject, cancel, cancellationQuote, reschedule };
