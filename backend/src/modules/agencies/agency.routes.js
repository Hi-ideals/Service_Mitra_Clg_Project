/**
 * Agency routes.
 *
 * Every route is agency-only and acts on the agency in the session. There is
 * deliberately no `/agencies/:id` write path: an identifier in a URL is one
 * missing ownership check away from letting one agency manage another's
 * people, so the identifier never appears there at all.
 */
import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { agencyOnly } from '../../middleware/authorize.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import * as controller from './agency.controller.js';
import * as schema from './agency.validation.js';

const router = Router();

router.use(authenticate, agencyOnly);

router.get('/me', controller.getMine);
router.patch('/me', validate({ body: schema.updateAgencySchema }), controller.updateMine);
router.get('/me/overview', controller.overview);

// ---------- the people the agency employs ----------
router.get('/me/providers', controller.listProviders);
router.post(
  '/me/providers',
  writeLimiter,
  validate({ body: schema.addProviderSchema }),
  controller.addProvider,
);
router.patch(
  '/me/providers/:id/status',
  writeLimiter,
  validate({ params: schema.idParamSchema, body: schema.providerStatusSchema }),
  controller.setProviderStatus,
);

// ---------- their work ----------
router.get('/me/bookings', validate({ query: schema.bookingListSchema }), controller.listBookings);

export default router;
