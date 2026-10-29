import asyncHandler from '../../utils/asyncHandler.js';
import { ok, created, paginated } from '../../utils/apiResponse.js';
import ApiError from '../../utils/ApiError.js';
import { q } from '../../middleware/validate.js';
import { getPagination } from '../../utils/pagination.js';
import { record, AUDIT } from '../../services/audit.service.js';
import * as service from './payment.service.js';
import * as invoices from './invoice.service.js';

const actor = (req) => ({
  type: req.user.role,
  id: req.user.id,
  providerId: req.user.providerId ?? null,
});

export const createOrder = asyncHandler(async (req, res) =>
  created(res, await service.createPaymentOrder(req.body.bookingId, req.user.id), 'Payment order created'),
);

/**
 * Confirms a payment from the browser's checkout handshake.
 *
 * The service re-checks the signature and reads the payment back from the
 * gateway, so nothing here trusts what the browser sent.
 */
export const verifyCheckout = asyncHandler(async (req, res) =>
  ok(res, await service.verifyCheckout({ ...req.body, customerId: req.user.id }), {
    message: 'Payment confirmed',
  }),
);

export const status = asyncHandler(async (req, res) =>
  ok(res, await service.getPaymentStatus(req.params.id, actor(req))),
);

/**
 * Gateway webhook.
 *
 * Unauthenticated by necessity - the gateway has no token. The signature over
 * the raw body is the authentication, and it is verified before anything is
 * acted on.
 */
export const webhook = asyncHandler(async (req, res) => {
  const signature =
    req.headers['x-webhook-signature'] || req.headers['x-razorpay-signature'] || null;

  const result = await service.handleWebhook({
    rawBody: req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body),
    signature,
    parsedBody: req.body,
  });

  // Always 200 on a delivery we understood, including duplicates - anything
  // else makes the gateway retry a webhook we have already applied.
  return ok(res, result, { message: result.duplicate ? 'Already processed' : 'Processed' });
});

export const refund = asyncHandler(async (req, res) => {
  const result = await service.refund({
    bookingId: req.params.id,
    amountMinor: req.body.amountMinor,
    reason: req.body.reason,
    initiatedBy: 'admin',
    adminId: req.user.id,
  });

  await record(req, {
    action: AUDIT.REFUND_ISSUED,
    entityType: 'booking',
    entityId: req.params.id,
    after: result,
    reason: req.body.reason,
  });

  return ok(res, result, {
    message: result.isFullRefund ? 'Full refund issued' : 'Partial refund issued',
  });
});

export const earnings = asyncHandler(async (req, res) => {
  if (!req.user.providerId) throw ApiError.forbidden('This account has no provider profile');
  const { page, limit, offset } = getPagination(q(req));
  const result = await service.earnings(req.user.providerId, { limit, offset });
  return ok(res, result, { meta: { page, limit, total: result.total } });
});

export const listInvoices = asyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(q(req));
  const result = await invoices.listInvoices(actor(req), { limit, offset });
  return paginated(res, result.items, { page, limit, total: result.total });
});

export const getInvoice = asyncHandler(async (req, res) =>
  ok(res, await invoices.getInvoice(req.params.id, actor(req))),
);

export default {
  createOrder, verifyCheckout, status, webhook, refund, earnings, listInvoices, getInvoice,
};
