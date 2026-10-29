/** Shared domain vocabulary. Values here are mirrored by database enums. */

export const ROLES = Object.freeze({
  CUSTOMER: 'customer',
  PROVIDER: 'provider',
  ADMIN: 'admin',
  /**
   * A business that employs providers.
   *
   * An agency never takes a booking itself and never holds money. It creates
   * providers, carries the verification they inherit, and watches their work.
   */
  AGENCY: 'agency',
});

export const VERIFICATION_STATUS = Object.freeze({
  UNSUBMITTED: 'unsubmitted',
  PENDING: 'pending',
  INFO_REQUESTED: 'info_requested',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  SUSPENDED: 'suspended',
});

/** The booking lifecycle spine from the architecture document. */
export const BOOKING_STATUS = Object.freeze({
  REQUESTED: 'requested',
  ACCEPTED: 'accepted',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  DISPUTED: 'disputed',
  REFUNDED: 'refunded',
});

export const PAYMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  AUTHORIZED: 'authorized',
  PAID: 'paid',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'partially_refunded',
});

export const PAYOUT_STATUS = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  PAID: 'paid',
  FAILED: 'failed',
  ON_HOLD: 'on_hold',
});

export default { ROLES, VERIFICATION_STATUS, BOOKING_STATUS, PAYMENT_STATUS, PAYOUT_STATUS };
