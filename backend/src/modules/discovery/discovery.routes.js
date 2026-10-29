/**
 * Discovery routes - entirely public.
 *
 * A customer must be able to search, compare and read a provider profile
 * before creating an account; the account is only needed to book. Contact
 * details are withheld until a booking is accepted, so nothing sensitive is
 * exposed by leaving these open.
 */
import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import * as controller from './discovery.controller.js';
import * as schema from './discovery.validation.js';

const router = Router();

router.get('/search', validate({ query: schema.searchSchema }), controller.search);
router.get('/featured', validate({ query: schema.featuredSchema }), controller.featured);
router.get('/suggest', validate({ query: schema.suggestSchema }), controller.suggest);
router.get(
  '/:id',
  validate({ params: schema.profileParamSchema, query: schema.profileQuerySchema }),
  controller.profile,
);

export default router;
