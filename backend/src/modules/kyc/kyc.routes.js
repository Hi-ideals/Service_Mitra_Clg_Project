/**
 * Verification routes.
 *
 * Providers submit and upload; admins review and decide. The two sets are
 * mounted separately so that no provider-facing path can ever reach a decision
 * endpoint by accident.
 */
import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { providerOnly, adminOnly, agencyOnly } from '../../middleware/authorize.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import { uploadSingle } from '../../middleware/upload.js';
import * as controller from './kyc.controller.js';
import * as schema from './kyc.validation.js';

// ---------- provider-facing: /kyc ----------
export const providerRouter = Router();

providerRouter.use(authenticate, providerOnly);

providerRouter.get('/me', controller.getMine);
providerRouter.post('/me', writeLimiter, validate({ body: schema.submitSchema }), controller.submit);

providerRouter.post(
  '/me/documents',
  writeLimiter,
  uploadSingle('file'),
  validate({ body: schema.documentSchema }),
  controller.uploadDocument,
);

providerRouter.delete(
  '/me/documents/:id',
  validate({ params: schema.idParamSchema }),
  controller.removeDocument,
);

// ---------- agency-facing: /agency-kyc ----------
// The agency verifies itself once; the providers it employs inherit the
// result. Same documents, same queue, same admin screen.
export const agencyRouter = Router();

agencyRouter.use(authenticate, agencyOnly);

agencyRouter.get('/me', controller.getAgencyKyc);
agencyRouter.post('/me', writeLimiter, validate({ body: schema.submitSchema }), controller.submitAgencyKyc);
agencyRouter.post(
  '/me/documents',
  writeLimiter,
  uploadSingle('file'),
  validate({ body: schema.documentSchema }),
  controller.uploadAgencyDocument,
);
agencyRouter.delete(
  '/me/documents/:id',
  validate({ params: schema.idParamSchema }),
  controller.removeAgencyDocument,
);

// ---------- admin-facing: /admin/kyc ----------
export const adminRouter = Router();

adminRouter.use(authenticate, adminOnly);

adminRouter.get('/', validate({ query: schema.queueSchema }), controller.queue);
adminRouter.get('/counts', controller.counts);
adminRouter.get('/:id', validate({ params: schema.idParamSchema }), controller.detail);

adminRouter.post(
  '/:id/approve',
  validate({ params: schema.idParamSchema, body: schema.approveSchema }),
  controller.approve,
);
adminRouter.post(
  '/:id/reject',
  validate({ params: schema.idParamSchema, body: schema.rejectSchema }),
  controller.reject,
);
adminRouter.post(
  '/:id/request-info',
  validate({ params: schema.idParamSchema, body: schema.requestInfoSchema }),
  controller.requestInfo,
);

// Acts on a provider profile rather than a submission - suspension is usually
// about conduct, not paperwork.
adminRouter.patch(
  '/providers/:id/status',
  validate({ params: schema.idParamSchema, body: schema.providerStatusSchema }),
  controller.setProviderStatus,
);

// ---------- signed file delivery: /files ----------
// Deliberately unauthenticated: the signature IS the authorisation, and it
// expires in minutes. This lets an <img> or <a download> tag work without
// attaching a bearer token.
export const fileRouter = Router();
fileRouter.get('/', validate({ query: schema.signedFileSchema }), controller.serveFile);

export default { providerRouter, agencyRouter, adminRouter, fileRouter };
