/**
 * Saved addresses.
 *
 * Customers only. A provider has a service area rather than a delivery
 * address, and an admin has no reason to hold one here.
 */
import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { customerOnly } from '../../middleware/authorize.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import * as controller from './address.controller.js';
import * as schema from './address.validation.js';

export const addressRouter = Router();

addressRouter.use(authenticate, customerOnly);

addressRouter.get('/', controller.list);

addressRouter.post(
  '/',
  writeLimiter,
  validate({ body: schema.createAddressSchema }),
  controller.create,
);

addressRouter.patch(
  '/:id/default',
  validate({ params: schema.idParamSchema }),
  controller.setDefault,
);

addressRouter.delete('/:id', validate({ params: schema.idParamSchema }), controller.remove);

export default addressRouter;
