/**
 * Review routes.
 *
 * Reading a provider's reviews is public - they are the whole point of the
 * profile page, and a customer compares providers before signing up. Writing
 * one requires having been the customer on a completed booking, which the
 * service enforces rather than the router.
 */
import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { customerOnly, providerOnly, adminOnly } from '../../middleware/authorize.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import * as controller from './review.controller.js';
import * as schema from './review.validation.js';

// ---------- public: /providers/:id/reviews ----------
export const publicRouter = Router({ mergeParams: true });

publicRouter.get(
  '/',
  validate({ params: schema.idParamSchema, query: schema.providerReviewsSchema }),
  controller.forProvider,
);

publicRouter.get('/summary', validate({ params: schema.idParamSchema }), controller.summary);

// ---------- /reviews ----------
export const reviewRouter = Router();

reviewRouter.use(authenticate);

reviewRouter.post(
  '/',
  customerOnly,
  writeLimiter,
  validate({ body: schema.createReviewSchema }),
  controller.create,
);

reviewRouter.get('/mine', customerOnly, validate({ query: schema.listSchema }), controller.mine);
reviewRouter.get('/pending', customerOnly, controller.pending);

// The provider's side of the same coin: /mine is what you wrote, /received is
// what was written about you. Both fixed segments, so neither can be mistaken
// for the /:id routes below.
reviewRouter.get(
  '/received',
  providerOnly,
  validate({ query: schema.listSchema }),
  controller.received,
);

reviewRouter.post(
  '/:id/reply',
  providerOnly,
  validate({ params: schema.idParamSchema, body: schema.replySchema }),
  controller.reply,
);

// Anyone signed in may report - including the provider being reviewed, which
// is usually who spots a fake first.
reviewRouter.post(
  '/:id/report',
  writeLimiter,
  validate({ params: schema.idParamSchema, body: schema.reportSchema }),
  controller.report,
);

// ---------- /admin/reviews ----------
export const adminRouter = Router();

adminRouter.use(authenticate, adminOnly);
adminRouter.get('/', validate({ query: schema.queueSchema }), controller.queue);
adminRouter.patch(
  '/:id',
  validate({ params: schema.idParamSchema, body: schema.moderateSchema }),
  controller.moderate,
);

export default { publicRouter, reviewRouter, adminRouter };
