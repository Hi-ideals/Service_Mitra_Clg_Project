/**
 * Payment gateway adapter.
 *
 * Nothing outside this folder knows which provider is in use. Card and UPI
 * details never reach ServiceMitra servers at all - the gateway collects them
 * on its own hosted page, and we only ever see identifiers and a signature.
 *
 * The mock driver is deterministic and signs webhooks with the same HMAC
 * scheme a real provider uses, so the whole payment path - including signature
 * rejection and replay - is exercised in development and in tests.
 */
import crypto from 'node:crypto';
import env from '../../config/env.js';
import ApiError from '../../utils/ApiError.js';
import logger from '../../config/logger.js';
import razorpayDriver from './razorpay.js';

function hmac(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

const mockDriver = {
  name: 'mock',

  /**
   * Creates the order the client-side checkout opens against. The amount is
   * whatever the server computed; the browser cannot influence it.
   */
  async createOrder({ amountMinor, currency, reference, notes }) {
    return {
      gateway: 'mock',
      orderId: 'order_' + crypto.randomBytes(10).toString('hex'),
      amountMinor,
      currency,
      reference,
      notes,
      // What the frontend needs to open the checkout widget.
      checkout: {
        key: 'mock_key_' + env.NODE_ENV,
        amountMinor,
        currency,
        name: 'ServiceMitra',
        description: notes?.description ?? 'Service booking',
      },
    };
  },

  /**
   * Verifies a webhook against its signature header.
   *
   * Compared in constant time: a plain === leaks how much of the signature was
   * correct, which is enough to forge one given patience.
   */
  verifySignature(rawBody, signature) {
    if (!rawBody || !signature) return false;
    const expected = hmac(rawBody, env.PAYMENT_WEBHOOK_SECRET);
    const a = Buffer.from(String(signature));
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  },

  /** Normalises the provider's payload into the shape our service understands. */
  parseEvent(payload) {
    const entity = payload?.payload?.payment ?? payload?.payment ?? {};
    return {
      eventId: payload?.id ?? null,
      type: payload?.event ?? 'unknown',
      orderId: entity.order_id ?? null,
      paymentId: entity.id ?? null,
      amountMinor: entity.amount ?? null,
      method: entity.method ?? null,
      errorCode: entity.error_code ?? null,
      errorReason: entity.error_description ?? null,
    };
  },

  async refund({ paymentId, amountMinor, reason }) {
    logger.info({ paymentId, amountMinor, reason }, 'Mock gateway refund issued');
    return {
      refundId: 'rfnd_' + crypto.randomBytes(10).toString('hex'),
      status: 'processed',
      amountMinor,
    };
  },

  /**
   * Rebuilds the checkout payload for an order we already created.
   *
   * Deliberately omits `orderId`, exactly as `createOrder` does. The frontend
   * reads that field to decide whether a real gateway checkout window exists:
   * handing it one here sent the browser to Razorpay's widget carrying this
   * driver's fake key, which Razorpay answered with a 401 and the customer
   * saw as "Payment Failed". The two paths must describe the mock the same
   * way, or reopening a pending payment behaves differently from starting it.
   */
  checkoutConfig({ amountMinor, currency, description }) {
    return {
      key: 'mock_key_' + env.NODE_ENV,
      amountMinor,
      currency: currency || 'INR',
      name: 'ServiceMitra',
      description: description || 'Service booking',
    };
  },

  /** The mock accepts any checkout handshake - there is no real one to check. */
  verifyCheckoutSignature() {
    return true;
  },

  async payout({ providerRef, amountMinor, reference }) {
    logger.info({ providerRef, amountMinor, reference }, 'Mock gateway payout issued');
    return {
      payoutId: 'pout_' + crypto.randomBytes(10).toString('hex'),
      status: 'processed',
      amountMinor,
    };
  },
};

/**
 * Test and development helper: produces a correctly signed webhook body for
 * the MOCK driver, the way a real provider would. Never used in production,
 * and never valid against the razorpay driver.
 */
export function signWebhook(payloadObject) {
  const body = JSON.stringify(payloadObject);
  return { body, signature: hmac(body, env.PAYMENT_WEBHOOK_SECRET) };
}

const drivers = { mock: mockDriver, razorpay: razorpayDriver };

export function gateway() {
  const driver = drivers[env.PAYMENT_DRIVER];
  if (!driver) {
    throw ApiError.internal('Payment driver "' + env.PAYMENT_DRIVER + '" is not configured');
  }
  return driver;
}

export default { gateway, signWebhook };
