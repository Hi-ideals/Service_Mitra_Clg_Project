/**
 * Dispute routes.
 *
 * Both parties can read and discuss a dispute they are on; only an admin can
 * decide one. The shared read path is scoped by the service, not the router,
 * because "am I on this dispute" is a business question.
 */
import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { adminOnly } from '../../middleware/authorize.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import * as controller from './dispute.controller.js';
import * as schema from './dispute.validation.js';

// ---------- /disputes ----------
export const disputeRouter = Router();

disputeRouter.use(authenticate);

disputeRouter.post('/', writeLimiter, validate({ body: schema.raiseSchema }), controller.raise);
disputeRouter.get('/', validate({ query: schema.listSchema }), controller.list);
disputeRouter.get('/:id', validate({ params: schema.idParamSchema }), controller.detail);
disputeRouter.post(
  '/:id/messages',
  writeLimiter,
  validate({ params: schema.idParamSchema, body: schema.messageSchema }),
  controller.message,
);

// ---------- /admin/disputes ----------
export const adminDisputeRouter = Router();

adminDisputeRouter.use(authenticate, adminOnly);

adminDisputeRouter.get('/counts', controller.counts);
adminDisputeRouter.post('/:id/assign', validate({ params: schema.idParamSchema }), controller.assign);
adminDisputeRouter.post(
  '/:id/resolve',
  validate({ params: schema.idParamSchema, body: schema.resolveSchema }),
  controller.resolve,
);
adminDisputeRouter.post(
  '/:id/reject',
  validate({ params: schema.idParamSchema, body: schema.rejectSchema }),
  controller.reject,
);

export default { disputeRouter, adminDisputeRouter };
