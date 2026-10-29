/**
 * Razorpay checkout.
 *
 * The script is loaded on demand rather than in index.html: most visitors
 * never pay for anything, and there is no reason to make them download a
 * payment SDK to read a provider profile.
 */

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

let loader = null;

/** Loads the checkout script once. Concurrent callers share one load. */
export function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (loader) return loader;

  loader = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src="' + SCRIPT_SRC + '"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.Razorpay));
      existing.addEventListener('error', () => reject(new Error('Could not load the payment window')));
      return;
    }

    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve(window.Razorpay);
    script.onerror = () => {
      loader = null;
      reject(new Error('Could not load the payment window. Check your connection and try again.'));
    };
    document.body.appendChild(script);
  });

  return loader;
}

/**
 * Opens checkout and resolves with the handshake Razorpay returns.
 *
 * That handshake is sent to our API to be verified; nothing here decides that
 * a payment succeeded. Dismissing the window rejects with a `dismissed` flag
 * so the caller can tell "changed my mind" apart from "it failed".
 */
export async function openCheckout({ checkout, customer, onDismiss }) {
  const Razorpay = await loadRazorpay();

  return new Promise((resolve, reject) => {
    const instance = new Razorpay({
      key: checkout.key,
      order_id: checkout.orderId,
      amount: checkout.amountMinor,
      currency: checkout.currency || 'INR',
      name: checkout.name || 'ServiceMitra',
      description: checkout.description,
      prefill: {
        name: customer?.fullName || '',
        email: customer?.email || '',
        contact: customer?.phone || '',
      },
      theme: { color: '#0E7C66' },
      handler: (response) =>
        resolve({
          orderId: response.razorpay_order_id,
          paymentId: response.razorpay_payment_id,
          signature: response.razorpay_signature,
        }),
      modal: {
        ondismiss: () => {
          onDismiss?.();
          const error = new Error('Payment window closed');
          error.dismissed = true;
          reject(error);
        },
      },
    });

    // A declined card fires this rather than the handler.
    instance.on('payment.failed', (response) => {
      const error = new Error(
        response?.error?.description || 'The payment did not go through. Try another method.',
      );
      error.code = response?.error?.code;
      reject(error);
    });

    instance.open();
  });
}

export default { loadRazorpay, openCheckout };
