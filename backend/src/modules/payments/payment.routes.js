/**
 * Payment, invoice and earnings routes.
 *
 * The webhook is mounted separately and left unauthenticated on purpose: the
 * gateway has no bearer token, and the signature over the raw body is what
 * authenticates it instead.
 */
import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { customerOnly, providerOnly, adminOnly } from '../../middleware/authorize.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import * as controller from './payment.controller.js';
import * as schema from './payment.validation.js';

// ---------- /payments ----------
export const paymentRouter = Router();

paymentRouter.use(authenticate);

paymentRouter.post(
  '/orders',
  customerOnly,
  writeLimiter,
  validate({ body: schema.createOrderSchema }),
  controller.createOrder,
);

paymentRouter.post(
  '/verify',
  customerOnly,
  writeLimiter,
  validate({ body: schema.verifyCheckoutSchema }),
  controller.verifyCheckout,
);

paymentRouter.get(
  '/bookings/:id',
  validate({ params: schema.idParamSchema }),
  controller.status,
);

// Refunds move real money, so they are admin-only and audit-logged. Automatic
// cancellation refunds are issued by the service layer, not through here.
paymentRouter.post(
  '/bookings/:id/refund',
  adminOnly,
  validate({ params: schema.idParamSchema, body: schema.refundSchema }),
  controller.refund,
);

// ---------- /invoices ----------
export const invoiceRouter = Router();

invoiceRouter.use(authenticate);
invoiceRouter.get('/', validate({ query: schema.listSchema }), controller.listInvoices);
invoiceRouter.get('/:id', validate({ params: schema.idParamSchema }), controller.getInvoice);

// ---------- /earnings ----------
export const earningsRouter = Router();

earningsRouter.use(authenticate, providerOnly);
earningsRouter.get('/', validate({ query: schema.listSchema }), controller.earnings);

// ---------- /webhooks/payment ----------
export const webhookRouter = Router();

webhookRouter.post('/payment', controller.webhook);

export default { paymentRouter, invoiceRouter, earningsRouter, webhookRouter };
