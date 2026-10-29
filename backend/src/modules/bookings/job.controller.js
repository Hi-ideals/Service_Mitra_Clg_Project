import asyncHandler from '../../utils/asyncHandler.js';
import { ok } from '../../utils/apiResponse.js';
import ApiError from '../../utils/ApiError.js';
import * as realtime from '../../services/realtime.service.js';
import * as service from './job.service.js';
import * as bookingService from './booking.service.js';
import * as repo from './booking.repository.js';

const actor = (req) => ({
  type: req.user.role,
  id: req.user.id,
  providerId: req.user.providerId ?? null,
});

export const start = asyncHandler(async (req, res) =>
  ok(res, await service.startJob(req.params.id, actor(req)), {
    message: 'Job started. The customer has been notified.',
  }),
);

export const requestCompletionCode = asyncHandler(async (req, res) =>
  ok(res, await service.requestCompletionCode(req.params.id, actor(req), req.body), {
    message: 'Completion code sent to the customer',
  }),
);

export const complete = asyncHandler(async (req, res) =>
  ok(res, await service.completeJob(req.params.id, actor(req), req.body), {
    message: 'Job completed',
  }),
);

export const tracking = asyncHandler(async (req, res) =>
  ok(res, await service.trackingState(req.params.id, actor(req))),
);

/**
 * Live status stream for one booking.
 *
 * Access is checked once, at subscribe time, against the same participant rule
 * the REST endpoints use - an SSE connection is not a way around authorisation.
 */
export const stream = asyncHandler(async (req, res) => {
  const booking = await repo.findById(req.params.id);
  if (!booking) throw ApiError.notFound('Booking not found');
  bookingService.assertParticipant(booking, actor(req));

  const unsubscribe = realtime.subscribe(req.user.id, res, { channel: 'booking:' + booking.id });

  // Send the current state immediately, so a client that connects mid-job is
  // not left blank until something changes.
  res.write('event: snapshot\n');
  res.write('data: ' + JSON.stringify(await service.trackingState(req.params.id, actor(req))) + '\n\n');

  req.on('close', unsubscribe);
});

export default { start, requestCompletionCode, complete, tracking, stream };
