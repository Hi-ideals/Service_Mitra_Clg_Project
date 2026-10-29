/**
 * Razorpay driver.
 *
 * Talks to the REST API directly rather than through the SDK - the surface we
 * need is four calls, and a direct fetch keeps the dependency count down and
 * the failure modes visible.
 *
 * Card and UPI details never reach this server. Razorpay collects them on its
 * own checkout; we only ever see an order id, a payment id and a signature.
 */
import crypto from 'node:crypto';
import env from '../../config/env.js';
import logger from '../../config/logger.js';
import ApiError from '../../utils/ApiError.js';

const BASE = 'https://api.razorpay.com/v1';

function authHeader() {
  const token = Buffer.from(env.RAZORPAY_KEY_ID + ':' + env.RAZORPAY_KEY_SECRET).toString('base64');
  return 'Basic ' + token;
}

async function call(path, { method = 'GET', body } = {}) {
  let response;

  try {
    response = await fetch(BASE + path, {
      method,
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      // A gateway that has not answered in 15 seconds is not going to.
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    logger.error({ err: err.message, path }, 'Razorpay request failed');
    throw new ApiError(503, 'The payment gateway is not responding. Please try again.', {
      code: 'GATEWAY_UNAVAILABLE',
    });
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const description = payload?.error?.description || 'The payment gateway rejected the request';
    logger.error(
      { status: response.status, path, code: payload?.error?.code, description },
      'Razorpay returned an error',
    );

    // 4xx from the gateway is our mistake (bad amount, bad id); 5xx is theirs.
    throw new ApiError(response.status < 500 ? 400 : 503, description, {
      code: payload?.error?.code || 'GATEWAY_ERROR',
    });
  }

  return payload;
}

const razorpayDriver = {
  name: 'razorpay',

  /**
   * Creates the order the checkout widget opens against.
   *
   * Razorpay amounts are already in paise, which is what we store, so nothing
   * is converted here - conversion is where currency bugs come from.
   */
  async createOrder({ amountMinor, currency, reference, notes }) {
    const order = await call('/orders', {
      method: 'POST',
      body: {
        amount: amountMinor,
        currency: currency || 'INR',
        // Our own reference, echoed back on every webhook about this order.
        receipt: reference,
        notes: {
          bookingId: notes?.bookingId ?? '',
          description: notes?.description ?? '',
        },
      },
    });

    return {
      gateway: 'razorpay',
      orderId: order.id,
      amountMinor: order.amount,
      currency: order.currency,
      reference,
      notes,
      // Everything the browser needs to open Razorpay checkout. The key id is
      // public by design; the key secret never leaves this server.
      checkout: {
        key: env.RAZORPAY_KEY_ID,
        orderId: order.id,
        amountMinor: order.amount,
        currency: order.currency,
        name: 'ServiceMitra',
        description: notes?.description ?? 'Service booking',
      },
    };
  },

  /**
   * Rebuilds the checkout config for an order we already created.
   *
   * Used when a customer reopens a payment they abandoned. It deliberately
   * does NOT call the API: creating a second order would hand the browser an
   * id the database has never seen, and verification would then fail.
   */
  checkoutConfig({ orderId, amountMinor, currency, description }) {
    return {
      key: env.RAZORPAY_KEY_ID,
      orderId,
      amountMinor,
      currency: currency || 'INR',
      name: 'ServiceMitra',
      description: description || 'Service booking',
    };
  },

  /**
   * Verifies a webhook against the signature Razorpay puts in
   * x-razorpay-signature: HMAC-SHA256 of the raw body, keyed with the webhook
   * secret. Compared in constant time.
   */
  verifySignature(rawBody, signature) {
    if (!rawBody || !signature || !env.RAZORPAY_WEBHOOK_SECRET) return false;

    const expected = crypto
      .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    const a = Buffer.from(String(signature));
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;

    return crypto.timingSafeEqual(a, b);
  },

  /**
   * Verifies the handshake the browser gets back from checkout.
   *
   * This is a different signature from the webhook one: HMAC of
   * "order_id|payment_id" keyed with the API secret. It is a convenience for
   * the UI - the webhook remains the only thing that marks a payment paid.
   */
  verifyCheckoutSignature({ orderId, paymentId, signature }) {
    if (!orderId || !paymentId || !signature) return false;

    const expected = crypto
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(orderId + '|' + paymentId)
      .digest('hex');

    const a = Buffer.from(String(signature));
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;

    return crypto.timingSafeEqual(a, b);
  },

  /** Normalises a Razorpay webhook into the shape our service understands. */
  parseEvent(payload) {
    const entity = payload?.payload?.payment?.entity ?? {};

    return {
      // Razorpay does not put an id on the envelope, so the payment id plus
      // the event name identifies the delivery for idempotency purposes.
      eventId: payload?.id || (entity.id ? entity.id + ':' + payload?.event : null),
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
    const refund = await call('/payments/' + paymentId + '/refund', {
      method: 'POST',
      body: {
        amount: amountMinor,
        // Razorpay retries safely against this key, so a repeated call from
        // our own retry logic cannot refund twice.
        speed: 'normal',
        notes: { reason: (reason || '').slice(0, 250) },
      },
    });

    return {
      refundId: refund.id,
      status: refund.status,
      amountMinor: refund.amount,
    };
  },

  /**
   * Payouts are RazorpayX, a separate product with its own activation and
   * account structure. Until that is set up, a payout is recorded but not
   * actually sent - which is visible as a failed payout rather than a silent
   * one that never arrives.
   */
  async payout() {
    throw new ApiError(
      501,
      'Payouts are not connected yet. RazorpayX needs to be activated and RAZORPAYX_ACCOUNT set before providers can be paid automatically.',
      { code: 'PAYOUTS_NOT_CONFIGURED' },
    );
  },

  /** Reads a payment straight from the gateway, for reconciliation. */
  async fetchPayment(paymentId) {
    return call('/payments/' + paymentId);
  },

  async fetchOrderPayments(orderId) {
    const result = await call('/orders/' + orderId + '/payments');
    return result?.items ?? [];
  },
};

export default razorpayDriver;
