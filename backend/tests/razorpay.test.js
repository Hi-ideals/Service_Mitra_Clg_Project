/**
 * Razorpay driver.
 *
 * These test the parts that run without touching the network: signature
 * verification, event parsing and configuration guards. Those are exactly the
 * parts where a mistake is silent and expensive - a signature check that
 * always passes looks identical to one that works until somebody forges a
 * webhook.
 *
 * The API calls themselves are not mocked; they are exercised against
 * Razorpay's own test mode when keys are configured.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import razorpay from '../src/services/payment/razorpay.js';
import env from '../src/config/env.js';

const sign = (payload, secret) =>
  crypto.createHmac('sha256', secret).update(payload).digest('hex');

test('Razorpay driver', async (t) => {
  await t.test('a correctly signed webhook is accepted', () => {
    const secret = env.RAZORPAY_WEBHOOK_SECRET || 'test-webhook-secret';
    // The driver reads the secret from env, so the test has to use the same one.
    process.env.RAZORPAY_WEBHOOK_SECRET = secret;
    env.RAZORPAY_WEBHOOK_SECRET = secret;

    const body = JSON.stringify({ event: 'payment.captured', payload: {} });
    assert.equal(razorpay.verifySignature(body, sign(body, secret)), true);
  });

  await t.test('a forged signature is refused', () => {
    const body = JSON.stringify({ event: 'payment.captured', payload: {} });
    assert.equal(razorpay.verifySignature(body, 'f'.repeat(64)), false);
  });

  await t.test('a signature for a different body is refused', () => {
    const secret = env.RAZORPAY_WEBHOOK_SECRET;
    const original = JSON.stringify({ event: 'payment.captured', amount: 50000 });
    const tampered = JSON.stringify({ event: 'payment.captured', amount: 1 });

    assert.equal(
      razorpay.verifySignature(tampered, sign(original, secret)),
      false,
      'changing the amount invalidates the signature',
    );
  });

  await t.test('a missing signature or body is refused rather than throwing', () => {
    assert.equal(razorpay.verifySignature('', 'abc'), false);
    assert.equal(razorpay.verifySignature('{}', ''), false);
    assert.equal(razorpay.verifySignature(null, null), false);
  });

  await t.test('the checkout handshake is verified with the key secret', () => {
    const keySecret = 'test-key-secret';
    env.RAZORPAY_KEY_SECRET = keySecret;

    const orderId = 'order_ABC123';
    const paymentId = 'pay_XYZ789';
    const signature = sign(orderId + '|' + paymentId, keySecret);

    assert.equal(razorpay.verifyCheckoutSignature({ orderId, paymentId, signature }), true);

    assert.equal(
      razorpay.verifyCheckoutSignature({ orderId, paymentId: 'pay_SOMEONE_ELSE', signature }),
      false,
      'a signature cannot be reused for a different payment',
    );

    assert.equal(
      razorpay.verifyCheckoutSignature({ orderId, paymentId, signature: 'nope' }),
      false,
    );
  });

  await t.test('a webhook payload is parsed into our own shape', () => {
    const parsed = razorpay.parseEvent({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_123',
            order_id: 'order_456',
            amount: 32900,
            method: 'upi',
            status: 'captured',
          },
        },
      },
    });

    assert.equal(parsed.type, 'payment.captured');
    assert.equal(parsed.orderId, 'order_456');
    assert.equal(parsed.paymentId, 'pay_123');
    assert.equal(parsed.amountMinor, 32900, 'amounts stay in paise, unconverted');
    assert.equal(parsed.method, 'upi');
    assert.ok(parsed.eventId, 'every delivery gets an id, for idempotency');
  });

  await t.test('a failed payment carries its reason through', () => {
    const parsed = razorpay.parseEvent({
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: 'pay_fail',
            order_id: 'order_456',
            error_code: 'BAD_REQUEST_ERROR',
            error_description: 'Payment was declined by the bank',
          },
        },
      },
    });

    assert.equal(parsed.type, 'payment.failed');
    assert.equal(parsed.errorCode, 'BAD_REQUEST_ERROR');
    assert.match(parsed.errorReason, /declined/i);
  });

  await t.test('payouts refuse clearly rather than pretending to work', async () => {
    await assert.rejects(
      () => razorpay.payout({ amountMinor: 1000 }),
      (err) => {
        assert.equal(err.code, 'PAYOUTS_NOT_CONFIGURED');
        assert.match(err.message, /RazorpayX/);
        return true;
      },
      'an unconfigured payout must fail loudly, not silently succeed',
    );
  });
});
