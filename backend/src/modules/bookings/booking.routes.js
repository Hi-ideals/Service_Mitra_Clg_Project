/**
 * Booking routes.
 *
 * All three roles share these paths. What differs is scope, and that comes
 * from the token rather than the URL: a customer listing bookings sees their
 * own, a provider sees theirs, an admin sees everything. There is no parameter
 * that lets a caller widen their own scope.
 */
import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { customerOnly, providerOnly, requireVerifiedProvider } from '../../middleware/authorize.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import * as controller from './booking.controller.js';
import * as jobController from './job.controller.js';
import * as schema from './booking.validation.js';
import * as jobSchema from './job.validation.js';

const router = Router();

router.use(authenticate);

// ---------- shared ----------
router.get('/', validate({ query: schema.listSchema }), controller.list);
router.get('/counts', controller.counts);
router.get('/:id', validate({ params: schema.idParamSchema }), controller.detail);

// ---------- customer ----------
router.post(
  '/',
  customerOnly,
  writeLimiter,
  validate({ body: schema.createBookingSchema }),
  controller.create,
);

// ---------- provider decisions ----------
// Verification is re-checked here, not just at sign-in: a provider suspended
// mid-session must not be able to accept new work.
router.post(
  '/:id/accept',
  providerOnly,
  requireVerifiedProvider,
  validate({ params: schema.idParamSchema }),
  controller.accept,
);

router.post(
  '/:id/reject',
  providerOnly,
  validate({ params: schema.idParamSchema, body: schema.rejectSchema }),
  controller.reject,
);

// ---------- cancellation and rescheduling ----------
// Open to whoever is on the booking; the service decides what each party may
// do and what it costs.
router.get('/:id/cancellation-quote', validate({ params: schema.idParamSchema }), controller.cancellationQuote);

router.post(
  '/:id/cancel',
  validate({ params: schema.idParamSchema, body: schema.cancelSchema }),
  controller.cancel,
);

router.post(
  '/:id/reschedule',
  writeLimiter,
  validate({ params: schema.idParamSchema, body: schema.rescheduleSchema }),
  controller.reschedule,
);

// ---------- job tracking ----------
// Starting and completing are provider actions; a customer may also complete
// their own booking, which is why completion is not provider-only.
router.post(
  '/:id/start',
  providerOnly,
  requireVerifiedProvider,
  validate({ params: schema.idParamSchema }),
  jobController.start,
);

router.post(
  '/:id/completion-code',
  providerOnly,
  validate({ params: schema.idParamSchema, body: jobSchema.completionCodeSchema }),
  jobController.requestCompletionCode,
);

router.post(
  '/:id/complete',
  validate({ params: schema.idParamSchema, body: jobSchema.completeSchema }),
  jobController.complete,
);

router.get('/:id/tracking', validate({ params: schema.idParamSchema }), jobController.tracking);

// Live status stream. Access is checked at subscribe time against the same
// participant rule the REST endpoints use.
router.get('/:id/stream', validate({ params: schema.idParamSchema }), jobController.stream);

export default router;
