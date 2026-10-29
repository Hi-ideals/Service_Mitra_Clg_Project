/**
 * The booking state machine.
 *
 * This is the single guard every status change passes through. No controller,
 * worker or admin tool writes bookings.status directly - if it did, the side
 * effects that hang off a transition (notifications, payment capture,
 * invoicing, payout eligibility) would silently not happen.
 *
 * Each transition declares who may perform it and what must be true first.
 */
import { BOOKING_STATUS as S } from '../../config/constants.js';
import ApiError from '../../utils/ApiError.js';

export const TRANSITIONS = Object.freeze({
  [S.REQUESTED]: {
    [S.ACCEPTED]: { actors: ['provider'], label: 'accept the request' },
    [S.REJECTED]: { actors: ['provider'], label: 'decline the request' },
    [S.CANCELLED]: { actors: ['customer', 'admin', 'system'], label: 'cancel the request' },
  },
  [S.ACCEPTED]: {
    [S.IN_PROGRESS]: { actors: ['provider'], label: 'start the job' },
    [S.CANCELLED]: { actors: ['customer', 'provider', 'admin'], label: 'cancel the booking' },
  },
  [S.IN_PROGRESS]: {
    [S.COMPLETED]: { actors: ['provider', 'customer'], label: 'complete the job' },
    [S.CANCELLED]: { actors: ['admin'], label: 'cancel a job already under way' },
  },
  [S.COMPLETED]: {
    [S.DISPUTED]: { actors: ['customer', 'admin'], label: 'raise a dispute' },
  },
  [S.DISPUTED]: {
    [S.REFUNDED]: { actors: ['admin'], label: 'refund the customer' },
    [S.COMPLETED]: { actors: ['admin'], label: 'resolve in the provider\u2019s favour' },
  },
  // Terminal states.
  [S.REJECTED]: {},
  [S.CANCELLED]: {},
  [S.REFUNDED]: {},
});

/** States in which the booking still holds the provider's slot. */
export const LIVE_STATES = Object.freeze([S.REQUESTED, S.ACCEPTED, S.IN_PROGRESS]);

/** States after which no further action is possible. */
export const TERMINAL_STATES = Object.freeze([S.REJECTED, S.CANCELLED, S.REFUNDED]);

export const isLive = (status) => LIVE_STATES.includes(status);
export const isTerminal = (status) => TERMINAL_STATES.includes(status);

/** What this actor could do next - drives which buttons the UI renders. */
export function allowedTransitions(fromStatus, actorType) {
  const options = TRANSITIONS[fromStatus] ?? {};
  return Object.entries(options)
    .filter(([, rule]) => rule.actors.includes(actorType))
    .map(([to, rule]) => ({ to, label: rule.label }));
}

/**
 * Throws unless this actor may move this booking from `from` to `to`.
 * The messages are written for the person who hit the button, not for a log.
 */
export function assertTransition({ from, to, actorType }) {
  if (from === to) {
    throw ApiError.conflict('This booking is already ' + humanise(to));
  }

  const options = TRANSITIONS[from];

  if (!options || Object.keys(options).length === 0) {
    throw ApiError.conflict(
      'This booking is ' + humanise(from) + ' and can no longer be changed',
    );
  }

  const rule = options[to];
  if (!rule) {
    const possible = Object.keys(options).map(humanise).join(', ');
    throw ApiError.conflict(
      'A ' + humanise(from) + ' booking cannot become ' + humanise(to) +
        '. It can only move to: ' + possible + '.',
    );
  }

  if (!rule.actors.includes(actorType)) {
    throw ApiError.forbidden(
      'Only ' + rule.actors.join(' or ') + ' can ' + rule.label,
    );
  }

  return true;
}

export function humanise(status) {
  return {
    [S.REQUESTED]: 'requested',
    [S.ACCEPTED]: 'accepted',
    [S.IN_PROGRESS]: 'in progress',
    [S.COMPLETED]: 'completed',
    [S.REJECTED]: 'declined',
    [S.CANCELLED]: 'cancelled',
    [S.DISPUTED]: 'disputed',
    [S.REFUNDED]: 'refunded',
  }[status] ?? status;
}

export default { TRANSITIONS, LIVE_STATES, TERMINAL_STATES, isLive, isTerminal, allowedTransitions, assertTransition, humanise };
