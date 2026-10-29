/**
 * What counts as money the platform has actually collected.
 *
 * A job being marked complete is not revenue. The provider is credited only
 * when a payment settles - `settlePayment` is the single place that writes to
 * provider_earnings - so any admin figure that counts completion instead of
 * payment disagrees with the provider's own statement and with the payout
 * queue, and overstates the platform's income.
 *
 * Kept as one exported fragment rather than repeated in each query, because
 * the dashboard and the reports drifting apart is exactly the bug this fixes.
 *
 * 'partially_refunded' is included: some money genuinely changed hands. A
 * fully refunded payment is excluded - the customer has their money back.
 */
export const COLLECTED = `EXISTS (
  SELECT 1 FROM payments pay
   WHERE pay.booking_id = b.id
     AND pay.status IN ('paid', 'partially_refunded')
)`;

export default { COLLECTED };
