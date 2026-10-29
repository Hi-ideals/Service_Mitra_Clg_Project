/**
 * Provider self-service routes.
 *
 * The guard is applied per route rather than with a blanket router.use, and
 * that is deliberate: this router shares the /providers mount point with the
 * public discovery router. Blanket middleware would run - and reject - on
 * public paths like /providers/search before they ever reached discovery.
 *
 * Note what is NOT gated on verification here: an unverified provider must be
 * able to build a profile, add services and set hours, because that is exactly
 * the work they do while waiting for KYC approval. Only going online is gated,
 * and that check lives in the service layer where it can explain what is
 * still missing.
 */
import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { providerOnly } from '../../middleware/authorize.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import * as controller from './provider.controller.js';
import * as schema from './provider.validation.js';

const router = Router();

/** Every route below is provider-only. */
const guard = [authenticate, providerOnly];

// ---------- profile ----------
router.get('/me', guard, controller.getMyProfile);
router.patch('/me', guard, validate({ body: schema.updateProfileSchema }), controller.updateMyProfile);

// Where this provider gets paid. Provider-only: an admin reads the same data
// through the payout queue, which decides separately what it may show.
router.get('/me/payout-method', guard, controller.getPayoutMethod);
router.put(
  '/me/payout-method',
  guard,
  validate({ body: schema.payoutMethodSchema }),
  controller.setPayoutMethod,
);
router.patch('/me/status', guard, validate({ body: schema.availabilityStatusSchema }), controller.setStatus);

// ---------- services offered ----------
router.get('/me/services', guard, controller.listServices);
router.put('/me/services', guard, writeLimiter, validate({ body: schema.serviceSchema }), controller.upsertService);
router.delete('/me/services/:categoryId', guard, validate({ params: schema.categoryParamSchema }), controller.removeService);

// ---------- service areas ----------
router.get('/me/areas', guard, controller.listAreas);
router.post('/me/areas', guard, writeLimiter, validate({ body: schema.areaSchema }), controller.addArea);
router.patch('/me/areas/:id', guard, validate({ params: schema.idParamSchema, body: schema.areaUpdateSchema }), controller.updateArea);
router.delete('/me/areas/:id', guard, validate({ params: schema.idParamSchema }), controller.removeArea);

// ---------- availability ----------
router.get('/me/schedule', guard, controller.getSchedule);
router.put('/me/schedule', guard, writeLimiter, validate({ body: schema.scheduleSchema }), controller.replaceSchedule);
router.post('/me/schedule/windows', guard, validate({ body: schema.windowSchema }), controller.addWindow);
router.delete('/me/schedule/windows/:id', guard, validate({ params: schema.idParamSchema }), controller.removeWindow);
router.post('/me/schedule/exceptions', guard, validate({ body: schema.exceptionSchema }), controller.setException);
router.delete('/me/schedule/exceptions/:id', guard, validate({ params: schema.idParamSchema }), controller.removeException);

export default router;
