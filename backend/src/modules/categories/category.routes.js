/**
 * Catalogue routes.
 *
 * Browsing is public - a customer must be able to see what the platform offers
 * before creating an account. Everything that changes the catalogue is admin
 * only and audit-logged.
 */
import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { authenticate, optionalAuth } from '../../middleware/authenticate.js';
import { adminOnly } from '../../middleware/authorize.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import { uploadSingle } from '../../middleware/upload.js';
import * as controller from './category.controller.js';
import * as schema from './category.validation.js';

const router = Router();

// ---------- public browse ----------
// optionalAuth so an admin previewing the site sees inactive categories too.
router.get('/', optionalAuth, validate({ query: schema.listCategoriesSchema }), controller.list);
router.get('/tree', optionalAuth, validate({ query: schema.listCategoriesSchema }), controller.tree);
router.get('/:idOrSlug', validate({ params: schema.slugParamSchema }), controller.detail);

// ---------- admin ----------
router.post(
  '/',
  authenticate, adminOnly, writeLimiter,
  validate({ body: schema.createCategorySchema }),
  controller.create,
);

router.patch(
  '/:id',
  authenticate, adminOnly, writeLimiter,
  validate({ params: schema.idParamSchema, body: schema.updateCategorySchema }),
  controller.update,
);

// A photo for a top-level category, shown on its tile on the home page.
router.post(
  '/:id/image',
  authenticate, adminOnly, writeLimiter,
  validate({ params: schema.idParamSchema }),
  uploadSingle('file'),
  controller.uploadImage,
);

router.delete(
  '/:id',
  authenticate, adminOnly, writeLimiter,
  validate({ params: schema.idParamSchema }),
  controller.remove,
);

export default router;
