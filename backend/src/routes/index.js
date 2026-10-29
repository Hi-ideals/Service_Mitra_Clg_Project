/**
 * API v1 router. Feature routers are mounted here as each phase lands, so this
 * file doubles as the index of what the API currently exposes.
 */
import { Router } from 'express';
import env from '../config/env.js';
import docsRoutes from './docs.routes.js';
import agencyRouter from '../modules/agencies/agency.routes.js';
import authRoutes from '../modules/auth/auth.routes.js';
import categoryRoutes from '../modules/categories/category.routes.js';
import providerRoutes from '../modules/providers/provider.routes.js';
import discoveryRoutes from '../modules/discovery/discovery.routes.js';
import {
  disputeRouter,
  adminDisputeRouter,
} from '../modules/disputes/dispute.routes.js';
import {
  publicRouter as providerReviewRoutes,
  reviewRouter as reviewRoutes,
  adminRouter as adminReviewRoutes,
} from '../modules/reviews/review.routes.js';
import bookingRoutes from '../modules/bookings/booking.routes.js';
import addressRoutes from '../modules/addresses/address.routes.js';
import adminRoutes from '../modules/admin/admin.routes.js';
import {
  paymentRouter,
  invoiceRouter,
  earningsRouter,
  webhookRouter,
} from '../modules/payments/payment.routes.js';
import {
  providerRouter as kycRoutes,
  agencyRouter as agencyKycRoutes,
  adminRouter as adminKycRoutes,
  fileRouter,
} from '../modules/kyc/kyc.routes.js';

const router = Router();

router.use('/docs', docsRoutes);
router.use('/auth', authRoutes);
router.use('/categories', categoryRoutes);
// Self-service routes are matched first (/providers/me...), then the public
// discovery routes (/providers/search, /providers/:id) catch the rest.
router.use('/providers', providerRoutes);
router.use('/providers/:id/reviews', providerReviewRoutes);
router.use('/providers', discoveryRoutes);
router.use('/kyc', kycRoutes);
router.use('/admin/kyc', adminKycRoutes);
router.use('/bookings', bookingRoutes);
router.use('/addresses', addressRoutes);
router.use('/payments', paymentRouter);
router.use('/invoices', invoiceRouter);
router.use('/earnings', earningsRouter);
router.use('/agencies', agencyRouter);
router.use('/agency-kyc', agencyKycRoutes);
router.use('/reviews', reviewRoutes);
router.use('/admin/reviews', adminReviewRoutes);
router.use('/disputes', disputeRouter);
router.use('/admin/disputes', adminDisputeRouter);
router.use('/admin', adminRoutes);
router.use('/webhooks', webhookRouter);
router.use('/files', fileRouter);
// Phase 5+  kyc
// Phase 6+  discovery and search
// Phase 7+  bookings
// Phase 9+  payments, invoices
// Phase 10+ reviews
// Phase 11+ admin, analytics

router.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'ServiceMitra API',
    version: 'v1',
    environment: env.NODE_ENV,
    documentation: env.API_PREFIX + '/docs',
    endpoints: {
      health: '/health',
      ready: '/health/ready',
      auth: env.API_PREFIX + '/auth',
      categories: env.API_PREFIX + '/categories',
      providers: env.API_PREFIX + '/providers',
      search: env.API_PREFIX + '/providers/search',
      kyc: env.API_PREFIX + '/kyc',
      adminKyc: env.API_PREFIX + '/admin/kyc',
      bookings: env.API_PREFIX + '/bookings',
      payments: env.API_PREFIX + '/payments',
      invoices: env.API_PREFIX + '/invoices',
      earnings: env.API_PREFIX + '/earnings',
      reviews: env.API_PREFIX + '/reviews',
      disputes: env.API_PREFIX + '/disputes',
      admin: env.API_PREFIX + '/admin',
    },
  });
});

export default router;
