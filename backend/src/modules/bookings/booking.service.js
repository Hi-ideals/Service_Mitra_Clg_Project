/**
 * Booking business logic - the spine of the platform.
 *
 * Two things are enforced here that nothing else in the system can be trusted
 * to get right: the requested slot must genuinely be available, and the price
 * is computed server-side from the provider's published rate. The client never
 * supplies an amount.
 */
import { withTransaction } from '../../db/pool.js';
import ApiError from '../../utils/ApiError.js';
import { BOOKING_STATUS as S, VERIFICATION_STATUS } from '../../config/constants.js';
import { reference, money, dateKey } from '../../utils/helpers.js';
import { notifyAllAsync } from '../../services/notification.service.js';
import settings from '../../services/settings.service.js';
import * as sm from './booking.stateMachine.js';
import * as repo from './booking.repository.js';

/**
 * Presentation. Contact details are released only once the booking is
 * accepted - before that, neither side gets the other's phone number.
 */
export function present(b, { viewerRole = 'customer', includeContact = null } = {}) {
  const contactReleased =
    includeContact ?? [S.ACCEPTED, S.IN_PROGRESS, S.COMPLETED, S.DISPUTED].includes(b.status);

  const actorType = viewerRole === 'admin' ? 'admin' : viewerRole;

  return {
    id: b.id,
    reference: b.reference,
    status: b.status,
    statusLabel: sm.humanise(b.status),
    isLive: sm.isLive(b.status),
    // The headline service. Kept for every caller that shows a booking on one
    // line - a list row, a notification, a report - which needs one name, not
    // a list. `services` below is the full set.
    category: {
      id: b.category_id,
      name: b.category_name,
      slug: b.category_slug,
      icon: b.category_icon,
    },
    services: (Array.isArray(b.items) ? b.items : []).map((item) => ({
      id: item.categoryId,
      name: item.name,
      slug: item.slug,
      icon: item.icon,
      priceMinor: Number(item.priceMinor),
      price: money.toMajor(Number(item.priceMinor)),
      estimatedMinutes: item.estimatedMinutes,
    })),
    customer: {
      id: b.customer_id,
      name: b.customer_name,
      avatarUrl: b.customer_avatar,
      phone: contactReleased && viewerRole !== 'customer' ? b.customer_phone : null,
    },
    provider: {
      id: b.provider_id,
      name: b.provider_business_name || b.provider_name,
      contactName: b.provider_name,
      avatarUrl: b.provider_avatar,
      rating: b.provider_rating === undefined ? null : Number(b.provider_rating),
      phone: contactReleased && viewerRole !== 'provider' ? b.provider_phone : null,
    },
    schedule: {
      start: b.scheduled_start,
      end: b.scheduled_end,
      respondBy: b.respond_by,
    },
    address: {
      line: b.address_line,
      city: b.address_city,
      state: b.address_state,
      pincode: b.address_pincode,
      lat: b.address_lat,
      lng: b.address_lng,
    },
    description: b.description,
    customerNotes: b.customer_notes,
    pricing: {
      quotedMinor: b.quoted_amount_minor,
      quoted: money.toMajor(b.quoted_amount_minor),
      visitChargeMinor: b.visit_charge_minor,
      finalMinor: b.final_amount_minor,
      final: b.final_amount_minor === null ? null : money.toMajor(b.final_amount_minor),
      commissionPercent: Number(b.commission_percent),
      commissionMinor: b.commission_amount_minor,
      providerEarningMinor: b.provider_earning_minor,
    },
    timestamps: {
      createdAt: b.created_at,
      acceptedAt: b.accepted_at,
      startedAt: b.started_at,
      completedAt: b.completed_at,
      cancelledAt: b.cancelled_at,
    },
    cancellation: b.cancelled_at
      ? { by: b.cancelled_by, reason: b.cancellation_reason }
      : null,
    rejectionReason: b.rejection_reason,
    disputeWindowEndsAt: b.dispute_window_ends_at,
    availableActions: sm.allowedTransitions(b.status, actorType),
  };
}

/**
 * Validates the requested slot against everything that could make it
 * unbookable, and returns the priced offering. Runs before the insert so the
 * customer gets a clear reason rather than a constraint violation.
 */
async function validateSlot({ providerId, categoryIds, start, pincode, city }) {
  const rows = await repo.serviceOfferings(providerId, categoryIds);
  const byId = new Map(rows.map((r) => [r.category_id, r]));

  // Named, not counted. "This provider does not offer Fan Installation" tells
  // the customer which box to untick; "one of your services is unavailable"
  // leaves them guessing.
  const missing = categoryIds.filter((id) => !byId.has(id));
  if (missing.length) {
    throw ApiError.badRequest(
      missing.length === categoryIds.length
        ? 'This provider does not offer the selected service' +
            (categoryIds.length > 1 ? 's' : '')
        : 'This provider no longer offers one of the services you chose',
    );
  }

  // Order the offerings the way the customer listed them, so item 0 - the
  // booking's headline category - is the service they picked first.
  const offerings = categoryIds.map((id) => byId.get(id));
  const [first] = offerings;

  if (first.deleted_at) throw ApiError.notFound('This provider is no longer available');
  if (first.verification_status !== VERIFICATION_STATUS.APPROVED) {
    throw ApiError.badRequest('This provider is not currently verified');
  }
  if (!first.is_accepting_bookings) {
    throw ApiError.badRequest('This provider is not accepting bookings right now');
  }

  const unavailable = offerings.find((o) => !o.is_active || !o.category_active);
  if (unavailable) {
    throw ApiError.badRequest(
      unavailable.category_name + ' is not currently available from this provider',
    );
  }

  const bookingRules = await settings.get('booking');
  const now = Date.now();

  if (start.getTime() <= now) {
    throw ApiError.badRequest('Choose a time in the future');
  }

  const maxAdvance = now + (bookingRules.maxAdvanceDays ?? 30) * 86400000;
  if (start.getTime() > maxAdvance) {
    throw ApiError.badRequest(
      'Bookings can be made up to ' + (bookingRules.maxAdvanceDays ?? 30) + ' days ahead',
    );
  }

  if (!(await repo.coversLocation(providerId, pincode, city))) {
    throw ApiError.badRequest('This provider does not serve ' + city + ' ' + pincode);
  }

  // Duration is the sum of the chosen services' estimates, taken from the
  // catalogue and never from the client, so the window that gets validated is
  // exactly the window that gets reserved. Two jobs take longer than one, and
  // the slot has to grow or the provider is double-booked by arithmetic.
  const totalMinutes = offerings.reduce((sum, o) => sum + (o.estimated_minutes || 60), 0);
  const end = new Date(start.getTime() + totalMinutes * 60000);

  // A date exception overrides the weekly rule entirely.
  const hhmm = (d) =>
    String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');

  const exception = await repo.exceptionForDate(providerId, dateKey(start));

  if (exception) {
    if (!exception.is_available) {
      throw ApiError.conflict(
        'The provider is unavailable on ' + dateKey(start) +
          (exception.reason ? ' (' + exception.reason + ')' : ''),
      );
    }
    const within =
      String(exception.start_time) <= hhmm(start) && String(exception.end_time) >= hhmm(end);
    if (!within) {
      throw ApiError.conflict(
        'On ' + dateKey(start) + ' this provider works ' +
          String(exception.start_time).slice(0, 5) + ' to ' + String(exception.end_time).slice(0, 5),
      );
    }
  } else {
    const window = await repo.coveringWindow(providerId, start.getDay(), hhmm(start), hhmm(end));
    if (!window) {
      throw ApiError.conflict('The provider does not work at that time. Pick another slot.');
    }
  }

  return { offerings, end, totalMinutes };
}

/**
 * Accepts `categoryIds: [...]` or the older single `categoryId`.
 *
 * The single form is still what a reschedule and any older client send, and
 * keeping both here means the rest of the service never has to care which
 * arrived. Duplicates are dropped rather than rejected: asking for the same
 * service twice is a slip, not a quantity, and the unique constraint on
 * booking_items would otherwise fail the whole request.
 */
function normaliseCategoryIds(payload) {
  const raw = Array.isArray(payload.categoryIds) && payload.categoryIds.length
    ? payload.categoryIds
    : [payload.categoryId];

  const seen = new Set();
  const ids = [];
  for (const id of raw) {
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }

  if (!ids.length) throw ApiError.badRequest('Choose at least one service');
  return ids;
}

/**
 * The booking-level commission rate, weighted by what each service costs.
 *
 * A booking mixing a 600-rupee item at 15% and a 200-rupee item at 10% settles
 * at 13.75%, not at the 12.5% a plain average would give - the expensive item
 * has to carry proportionally more of the rate. Rounded to the two decimals
 * the column stores.
 */
function weightedCommission(items) {
  const total = items.reduce((sum, item) => sum + item.priceMinor, 0);

  // Every item free: there is nothing to weight by, so fall back to the plain
  // average rather than dividing by zero.
  if (total <= 0) {
    return Number(
      (items.reduce((sum, item) => sum + item.commissionPercent, 0) / items.length).toFixed(2),
    );
  }

  const weighted = items.reduce(
    (sum, item) => sum + item.commissionPercent * item.priceMinor,
    0,
  );
  return Number((weighted / total).toFixed(2));
}

/**
 * Names a booking's work in a single phrase, for a notification or an email.
 *
 * "Switch & Socket Repair and 1 more" rather than just the headline service,
 * so a customer reading "we accepted your Switch & Socket Repair booking" is
 * not left wondering whether the fan was dropped.
 */
function describeWork(row) {
  const extra = Math.max(0, (Array.isArray(row.items) ? row.items.length : 1) - 1);
  if (!extra) return row.category_name;
  return row.category_name + ' and ' + extra + ' more';
}

/** Commission is frozen per booking, so a later settings change cannot rewrite history. */
async function resolveCommission(categoryCommission) {
  if (categoryCommission !== null && categoryCommission !== undefined) {
    return Number(categoryCommission);
  }
  const config = await settings.get('commission');
  return Number(config.defaultPercent);
}

// ---------------------------------------------------------------- create

export async function createBooking(customerId, payload) {
  const start = new Date(payload.scheduledStart);

  // The validator accepts either shape; normalise once, here, so everything
  // below deals in a list.
  const categoryIds = normaliseCategoryIds(payload);

  const { offerings, end } = await validateSlot({
    providerId: payload.providerId,
    categoryIds,
    start,
    pincode: payload.address?.pincode ?? null,
    city: payload.address?.city ?? null,
  });

  const bookingRules = await settings.get('booking');
  const respondBy = new Date(
    Math.min(
      Date.now() + (bookingRules.acceptWindowMinutes ?? 60) * 60000,
      // Never ask a provider to respond after the job was due to start.
      start.getTime(),
    ),
  );

  // Each service keeps its own category's commission rate, resolved now and
  // frozen on the item.
  const itemCommissions = await Promise.all(
    offerings.map((o) => resolveCommission(o.commission_percent)),
  );

  const items = offerings.map((o, index) => ({
    categoryId: o.category_id,
    priceMinor: Number(o.price_minor),
    estimatedMinutes: o.estimated_minutes || 60,
    commissionPercent: itemCommissions[index],
  }));

  // Prices come from the provider's published rates, never from the client.
  const quotedAmountMinor = items.reduce((sum, item) => sum + item.priceMinor, 0);

  /**
   * The visit charge was withdrawn from the product: a booking is quoted at
   * the sum of its services and nothing else.
   *
   * Zero rather than removed. The column still carries the charge on bookings
   * taken while the feature existed, and their invoices have to keep adding
   * up - rewriting those would change what a customer was already billed.
   */
  const visitChargeMinor = 0;

  // The booking-level rate is the price-weighted average of its items, which
  // is the rate that reproduces the sum of the per-item commissions when
  // applied to the whole. It is what the ledger and the payout use; the items
  // keep the exact per-category rates for anyone who needs the breakdown.
  const commissionPercent = weightedCommission(items);

  const booking = await withTransaction(async (tx) => {
    const created = await repo.create(tx, {
      reference: reference('BK'),
      customerId,
      providerId: payload.providerId,
      // Item 0 is the headline category, keeping bookings.category_id in step
      // with the first service the customer chose.
      categoryId: items[0].categoryId,
      scheduledStart: start,
      scheduledEnd: end,
      respondBy,
      description: payload.description ?? null,
      customerNotes: payload.customerNotes ?? null,
      addressId: payload.addressId ?? null,
      addressLine: payload.address.line,
      addressCity: payload.address.city,
      addressState: payload.address.state,
      addressPincode: payload.address.pincode,
      addressLat: payload.address.lat ?? null,
      addressLng: payload.address.lng ?? null,
      quotedAmountMinor,
      visitChargeMinor,
      commissionPercent,
    });

    await repo.createItems(tx, created.id, items);

    await repo.recordHistory(tx, {
      bookingId: created.id,
      fromStatus: null,
      toStatus: S.REQUESTED,
      actorType: 'customer',
      actorId: customerId,
      reason: items.length > 1 ? 'Booking requested (' + items.length + ' services)' : 'Booking requested',
    });

    return created;
  }).catch((err) => {
    // The exclusion constraint is the real authority on double booking - the
    // pre-check above can always lose a race with another customer.
    if (err.code === '23P01') {
      throw ApiError.conflict('That slot has just been taken. Please choose another time.');
    }
    throw err;
  });

  // Emailed as well as recorded in-app. A request that expires in an hour is
  // no use to a provider who is not sitting on the dashboard, and an ignored
  // request counts against their acceptance rate.
  const serviceNames = offerings.map((o) => o.category_name).join(', ');

  notifyAllAsync({
    userId: offerings[0].provider_user_id,
    eventType: 'booking.requested',
    title: 'New booking request - respond within the hour',
    body:
      'A customer has requested ' + serviceNames + ' on ' +
      start.toLocaleString('en-IN') + '. Respond before ' + respondBy.toLocaleString('en-IN') +
      ' or the request is cancelled automatically and counts against your acceptance rate.',
    actionLabel: 'View the request',
    actionPath: '/provider/jobs/' + booking.id,
    entityType: 'booking',
    entityId: booking.id,
  });

  return present(
    {
      ...booking,
      category_name: offerings[0].category_name,
      items: items.map((item, index) => ({
        categoryId: item.categoryId,
        name: offerings[index].category_name,
        priceMinor: item.priceMinor,
        estimatedMinutes: item.estimatedMinutes,
      })),
    },
    { viewerRole: 'customer' },
  );
}

// ---------------------------------------------------------------- transitions

/**
 * The one path through which a booking's status changes.
 *
 * Takes a row lock, re-reads the current status inside the transaction, runs
 * the state machine guard, writes the new status, and records history - so two
 * concurrent accept/cancel requests cannot both succeed.
 */
async function transition({ bookingId, to, actor, reason, patch = {}, authorise }) {
  return withTransaction(async (tx) => {
    const current = await repo.findForUpdate(tx, bookingId);
    if (!current) throw ApiError.notFound('Booking not found');

    if (authorise) authorise(current);

    sm.assertTransition({ from: current.status, to, actorType: actor.type });

    const updated = await repo.applyTransition(tx, bookingId, { status: to, patch });

    await repo.recordHistory(tx, {
      bookingId,
      fromStatus: current.status,
      toStatus: to,
      actorType: actor.type,
      actorId: actor.id ?? null,
      reason: reason ?? null,
    });

    if ([S.ACCEPTED, S.REJECTED].includes(to)) {
      await repo.refreshAcceptanceRate(tx, current.provider_id);
    }

    return { previous: current, booking: updated };
  });
}

export async function accept(bookingId, providerId, actorId) {
  const { booking } = await transition({
    bookingId,
    to: S.ACCEPTED,
    actor: { type: 'provider', id: actorId },
    reason: 'Accepted by provider',
    patch: { acceptedAt: new Date() },
    authorise: (current) => {
      if (current.provider_id !== providerId) {
        throw ApiError.forbidden('This booking was not assigned to you');
      }
    },
  });

  const full = await repo.findById(bookingId);

  notifyAllAsync({
    userId: full.customer_id,
    actionLabel: 'View your booking',
    actionPath: '/bookings/' + bookingId,
    eventType: 'booking.accepted',
    title: 'Your booking is confirmed',
    body:
      (full.provider_business_name || full.provider_name) +
      ' accepted your ' + describeWork(full) + ' booking for ' +
      new Date(full.scheduled_start).toLocaleString('en-IN') + '.',
    entityType: 'booking',
    entityId: bookingId,
  });

  return present(full, { viewerRole: 'provider' });
}

export async function reject(bookingId, providerId, actorId, reason) {
  await transition({
    bookingId,
    to: S.REJECTED,
    actor: { type: 'provider', id: actorId },
    reason,
    patch: { rejectionReason: reason },
    authorise: (current) => {
      if (current.provider_id !== providerId) {
        throw ApiError.forbidden('This booking was not assigned to you');
      }
    },
  });

  const full = await repo.findById(bookingId);

  notifyAllAsync({
    userId: full.customer_id,
    actionLabel: 'Find another professional',
    actionPath: '/search',
    eventType: 'booking.rejected',
    title: 'Your booking request was declined',
    body: reason + ' You can book another provider for the same slot.',
    entityType: 'booking',
    entityId: bookingId,
  });

  return present(full, { viewerRole: 'provider' });
}

// ---------------------------------------------------------------- cancellation

/**
 * Works out what cancelling now would cost, without cancelling.
 *
 * The customer sees this before confirming, so the fee is never a surprise
 * after the fact. A provider or admin cancelling never charges the customer.
 */
export async function quoteCancellation(booking, actorType) {
  const policy = await settings.get('cancellation');

  if (actorType !== 'customer') {
    return { feeMinor: 0, refundMinor: booking.quoted_amount_minor, reason: 'No fee - cancelled by ' + actorType };
  }

  const hoursUntil = (new Date(booking.scheduled_start).getTime() - Date.now()) / 3600000;

  if (booking.status === S.REQUESTED) {
    return { feeMinor: 0, refundMinor: booking.quoted_amount_minor, reason: 'The provider has not accepted yet, so there is no charge' };
  }

  if (hoursUntil >= (policy.freeWindowHours ?? 12)) {
    return {
      feeMinor: 0,
      refundMinor: booking.quoted_amount_minor,
      reason: 'Free cancellation, more than ' + (policy.freeWindowHours ?? 12) + ' hours before the appointment',
    };
  }

  const feeMinor = Math.round((booking.quoted_amount_minor * (policy.lateFeePercent ?? 20)) / 100);

  return {
    feeMinor,
    refundMinor: Math.max(0, booking.quoted_amount_minor - feeMinor),
    reason:
      'Late cancellation within ' + (policy.freeWindowHours ?? 12) + ' hours: a ' +
      (policy.lateFeePercent ?? 20) + '% fee of ' + money.format(feeMinor) + ' applies',
  };
}

export async function getCancellationQuote(bookingId, actor) {
  const booking = await repo.findById(bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');
  assertParticipant(booking, actor);
  return quoteCancellation(booking, actor.type);
}

export async function cancel(bookingId, actor, reason) {
  const existing = await repo.findById(bookingId);
  if (!existing) throw ApiError.notFound('Booking not found');
  assertParticipant(existing, actor);

  const quote = await quoteCancellation(existing, actor.type);

  const { booking } = await transition({
    bookingId,
    to: S.CANCELLED,
    actor,
    reason,
    patch: {
      cancelledAt: new Date(),
      cancelledBy: actor.type,
      cancellationReason: reason,
    },
  });

  /**
   * Tell both sides, not only the other one.
   *
   * This used to notify whoever did not do the cancelling, on the reasoning
   * that the person who pressed the button already knows. They do not: they
   * know they asked, not that it worked, and a cancellation is the moment
   * somebody most wants it in writing - it is the record that they are not
   * being charged and that nobody is turning up.
   *
   * It also left a hole. An administrator can cancel too, and with only
   * "the other side" told, that meant the customer heard and the provider
   * did not - so a professional could set out for a job that no longer
   * existed.
   */
  const cancelledBy =
    actor.type === 'customer' ? 'the customer'
      : actor.type === 'provider' ? 'the professional'
        : 'ServiceMitra';

  const work = describeWork(existing);

  const recipients = [
    {
      userId: existing.customer_id,
      actionPath: '/bookings/' + bookingId,
      mine: actor.type === 'customer',
    },
    {
      userId: existing.provider_user_id,
      actionPath: '/provider/jobs/' + bookingId,
      mine: actor.type === 'provider',
    },
  ];

  for (const to of recipients) {
    if (!to.userId) continue;

    notifyAllAsync({
      userId: to.userId,
      actionLabel: 'See the booking',
      actionPath: to.actionPath,
      eventType: 'booking.cancelled',
      title: to.mine ? 'You cancelled this booking' : 'Booking cancelled',
      body: to.mine
        ? 'Booking ' + existing.reference + ' for ' + work +
          ' has been cancelled. Reason: ' + reason
        : 'Booking ' + existing.reference + ' for ' + work +
          ' was cancelled by ' + cancelledBy + '. Reason: ' + reason,
      entityType: 'booking',
      entityId: bookingId,
    });
  }

  return { booking: present(await repo.findById(bookingId), { viewerRole: actor.type }), cancellation: quote };
}

// ---------------------------------------------------------------- reschedule

/**
 * Moving a booking re-runs the full slot validation, because the new time has
 * to be as legitimate as the original one. An accepted booking moved by the
 * customer goes back to requested - the provider agreed to a time, not to an
 * open-ended commitment.
 */
export async function reschedule(bookingId, actor, { scheduledStart, reason }) {
  const existing = await repo.findById(bookingId);
  if (!existing) throw ApiError.notFound('Booking not found');
  assertParticipant(existing, actor);

  if (!sm.isLive(existing.status)) {
    throw ApiError.conflict('A ' + sm.humanise(existing.status) + ' booking cannot be rescheduled');
  }
  if (existing.status === S.IN_PROGRESS) {
    throw ApiError.conflict('This job has already started and cannot be rescheduled');
  }

  const start = new Date(scheduledStart);

  // Re-validate against every service on the booking, not just the headline
  // one. Passing `category_id` alone would re-reserve a two-service booking
  // for the length of its first service, quietly shrinking the slot and
  // freeing time the provider is still committed to.
  const existingItems = await repo.itemsFor(bookingId);
  const categoryIds = existingItems.length
    ? existingItems.map((item) => item.category_id)
    : [existing.category_id];

  const { end } = await validateSlot({
    providerId: existing.provider_id,
    categoryIds,
    start,
    pincode: existing.address_pincode,
    city: existing.address_city,
  });

  const backToRequested = actor.type === 'customer' && existing.status === S.ACCEPTED;

  const updated = await withTransaction(async (tx) => {
    const row = await repo.reschedule(tx, bookingId, { start, end });

    if (backToRequested) {
      await repo.applyTransition(tx, bookingId, { status: S.REQUESTED, patch: {} });
    }

    await repo.recordHistory(tx, {
      bookingId,
      fromStatus: existing.status,
      toStatus: backToRequested ? S.REQUESTED : existing.status,
      actorType: actor.type,
      actorId: actor.id,
      reason: reason || 'Rescheduled',
      metadata: { from: existing.scheduled_start, to: start.toISOString() },
    });

    return row;
  }).catch((err) => {
    if (err.code === '23P01') {
      throw ApiError.conflict('That slot is already taken. Please choose another time.');
    }
    throw err;
  });

  const notifyUserId = actor.type === 'customer' ? existing.provider_user_id : existing.customer_id;
  const notifyPath =
    actor.type === 'customer' ? '/provider/jobs/' + bookingId : '/bookings/' + bookingId;

  notifyAllAsync({
    userId: notifyUserId,
    actionLabel: backToRequested ? 'Confirm the new time' : 'See the booking',
    actionPath: notifyPath,
    eventType: 'booking.rescheduled',
    title: 'Booking rescheduled',
    body:
      'Booking ' + existing.reference + ' moved to ' + start.toLocaleString('en-IN') +
      (backToRequested ? '. Please confirm the new time.' : '.'),
    entityType: 'booking',
    entityId: bookingId,
  });

  return {
    booking: present(await repo.findById(bookingId), { viewerRole: actor.type }),
    requiresReconfirmation: backToRequested,
  };
}

/** Ownership: the caller must actually be on this booking. Admins bypass. */
function assertParticipant(booking, actor) {
  if (actor.type === 'admin') return true;
  if (actor.type === 'customer' && booking.customer_id === actor.id) return true;
  if (actor.type === 'provider' && booking.provider_id === actor.providerId) return true;
  throw ApiError.forbidden('You do not have access to this booking');
}

export { assertParticipant, transition };

// ---------------------------------------------------------------- reads

export async function getBooking(bookingId, actor) {
  const booking = await repo.findById(bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');
  assertParticipant(booking, actor);

  const [history, cancellationQuote] = await Promise.all([
    repo.history(bookingId),
    sm.isLive(booking.status) ? quoteCancellation(booking, actor.type) : Promise.resolve(null),
  ]);

  return {
    ...present(booking, { viewerRole: actor.type }),
    history: history.map((h) => ({
      from: h.from_status,
      to: h.to_status,
      label: sm.humanise(h.to_status),
      actorType: h.actor_type,
      actorName: h.actor_name,
      reason: h.reason,
      at: h.created_at,
    })),
    cancellationQuote,
  };
}

/**
 * Scope is derived from the caller's identity, never from the request - a
 * customer cannot list someone else's bookings by changing a query string.
 */
export async function listBookings(actor, filters) {
  const scope =
    actor.type === 'customer'
      ? { customerId: actor.id }
      : actor.type === 'provider'
        ? { providerId: actor.providerId }
        : {};

  const { items, total } = await repo.list({ ...scope, ...filters });

  return {
    items: items.map((b) => present(b, { viewerRole: actor.type })),
    total,
  };
}

export async function counts(actor) {
  const scope =
    actor.type === 'customer'
      ? { customerId: actor.id }
      : actor.type === 'provider'
        ? { providerId: actor.providerId }
        : {};

  const row = await repo.statusCounts(scope);
  return {
    requested: row.requested,
    accepted: row.accepted,
    inProgress: row.in_progress,
    completed: row.completed,
    cancelled: row.cancelled,
    rejected: row.rejected,
    total: row.total,
  };
}

/**
 * Auto-cancels requests the provider never answered. Run by a scheduled worker
 * in Phase 12; exposed here so the rule lives with the rest of the lifecycle.
 */
export async function expireStaleRequests() {
  const stale = await repo.expiredRequests(100);
  const expired = [];

  for (const row of stale) {
    try {
      await transition({
        bookingId: row.id,
        to: S.CANCELLED,
        actor: { type: 'system', id: null },
        reason: 'The provider did not respond in time',
        patch: {
          cancelledAt: new Date(),
          cancelledBy: 'system',
          cancellationReason: 'The provider did not respond in time',
        },
      });

      expired.push(row.reference);

      notifyAllAsync({
        userId: row.customer_id,
        actionLabel: 'Find another professional',
        actionPath: '/search',
        eventType: 'booking.expired',
        title: 'Your booking request expired',
        body: 'Booking ' + row.reference + ' expired because the provider did not respond. You have not been charged.',
        entityType: 'booking',
        entityId: row.id,
      });
    } catch {
      // A booking answered between the query and the update is not an error.
    }
  }

  return { expired: expired.length, references: expired };
}

export default {
  createBooking, accept, reject, cancel, reschedule, getBooking,
  listBookings, counts, getCancellationQuote, expireStaleRequests, present,
};
