/**
 * Job status tracking - the second half of the booking lifecycle.
 *
 * Phase 7 got a booking accepted. This module takes it from accepted through
 * in progress to completed, and it is deliberately strict about completion:
 * a provider cannot declare a job finished on their own say-so, because
 * completion is what releases payment and unlocks the review.
 */
import bcrypt from 'bcryptjs';
import { withTransaction, queryOne } from '../../db/pool.js';
import ApiError from '../../utils/ApiError.js';
import { BOOKING_STATUS as S } from '../../config/constants.js';
import { numericOtp, money } from '../../utils/helpers.js';
import { notifyAsync, notifyAllAsync } from '../../services/notification.service.js';
import { otpEmail } from '../../services/email/templates.js';
import { codeCanBeEchoed } from '../../services/email/mailer.js';
import * as realtime from '../../services/realtime.service.js';
import settings from '../../services/settings.service.js';
import * as sm from './booking.stateMachine.js';
import * as repo from './booking.repository.js';
import { present, transition, assertParticipant } from './booking.service.js';

/** A provider may arrive early, but not arbitrarily early. */
const EARLY_START_GRACE_MINUTES = 300;

/** Pushes the new state to both parties' open streams. */
function broadcast(booking, event, extra = {}) {
  realtime.publishToBooking(
    { customerUserId: booking.customer_id, providerUserId: booking.provider_user_id },
    event,
    {
      bookingId: booking.id,
      reference: booking.reference,
      status: booking.status,
      statusLabel: sm.humanise(booking.status),
      at: new Date().toISOString(),
      ...extra,
    },
  );
}

// ---------------------------------------------------------------- start

export async function startJob(bookingId, actor) {
  const existing = await repo.findById(bookingId);
  if (!existing) throw ApiError.notFound('Booking not found');
  assertParticipant(existing, actor);

  const startsAt = new Date(existing.scheduled_start).getTime();
  const earliest = startsAt - EARLY_START_GRACE_MINUTES * 60000;

  if (Date.now() < earliest) {
    throw ApiError.badRequest(
      'This job is scheduled for ' + new Date(startsAt).toLocaleString('en-IN') +
        '. You can start it from ' + EARLY_START_GRACE_MINUTES + ' minutes before that.',
    );
  }

  await transition({
    bookingId,
    to: S.IN_PROGRESS,
    actor,
    reason: 'Provider started the job',
    patch: { startedAt: new Date() },
  });

  const booking = await repo.findById(bookingId);
  broadcast(booking, 'booking.started');

  notifyAllAsync({
    userId: booking.customer_id,
    actionLabel: 'Track this job',
    actionPath: '/bookings/' + bookingId,
    eventType: 'booking.started',
    title: 'Your job has started',
    body:
      (booking.provider_business_name || booking.provider_name) +
      ' has started work on booking ' + booking.reference + '.',
    entityType: 'booking',
    entityId: bookingId,
  });

  return present(booking, { viewerRole: actor.type });
}

// ---------------------------------------------------------------- completion

/**
 * Works out the money for a completed job.
 *
 * The final amount may differ from the quote after inspection, but not without
 * limit and not without the customer confirming it - the code the customer
 * reads out is consent to the amount as well as to the work.
 */
async function settleAmounts(booking, requestedFinalMinor) {
  const quoted = booking.quoted_amount_minor + (booking.visit_charge_minor ?? 0);
  const finalMinor = requestedFinalMinor ?? quoted;

  if (finalMinor < 0) throw ApiError.badRequest('The final amount cannot be negative');

  /**
   * The quote is a floor as well as a promise.
   *
   * A provider could otherwise agree one figure with the customer, enter a
   * lower one here, and take the difference in cash - the customer has no
   * reason to object, because they pay less on the platform, and the only
   * loser is the commission. Holding the final amount at or above the quote
   * removes the incentive outright.
   *
   * The cost is real: a job that genuinely turns out smaller cannot be
   * discounted, and has to be cancelled and rebooked instead. That trade was
   * made deliberately.
   */
  if (finalMinor < quoted) {
    throw ApiError.badRequest(
      'The final amount cannot be less than the ' + money.format(quoted) +
        ' quoted for this booking.',
    );
  }

  /**
   * The ceiling is the whole visit's, not one service's.
   *
   * This read the cap of `booking.category_id` alone. On a booking covering a
   * 1,000-rupee fan fitting and a 500-rupee socket repair, the provider was
   * held to the socket repair's 1,000-rupee cap and could not even charge the
   * 1,500 that was quoted and agreed - the job could not be completed at all.
   *
   * A category with no cap makes the whole booking uncapped: that category is
   * priced on inspection by design, and summing the others would invent a
   * limit the catalogue never set.
   */
  const caps = await queryOne(
    `SELECT COUNT(*)::int                       AS service_count,
            bool_or(c.max_price_minor IS NULL)  AS has_uncapped,
            SUM(c.max_price_minor)::bigint      AS total_max_minor,
            MIN(c.name)                         AS first_name
       FROM booking_items bi
       JOIN service_categories c ON c.id = bi.category_id
      WHERE bi.booking_id = $1`,
    [booking.id],
  );

  // Falls back to the headline category for any booking predating items.
  const fallback =
    caps && caps.service_count > 0
      ? null
      : await queryOne(
          'SELECT name, max_price_minor FROM service_categories WHERE id = $1',
          [booking.category_id],
        );

  const capped = fallback
    ? fallback.max_price_minor !== null
    : !caps.has_uncapped && caps.total_max_minor !== null;

  if (capped) {
    const maxMinor = fallback ? fallback.max_price_minor : Number(caps.total_max_minor);
    const ceiling = maxMinor + (booking.visit_charge_minor ?? 0);

    if (finalMinor > ceiling) {
      const count = fallback ? 1 : caps.service_count;
      throw ApiError.badRequest(
        'The final amount cannot exceed the ' + money.format(ceiling) +
          (count > 1
            ? ' ceiling for the ' + count + ' services on this booking'
            : ' ceiling set for ' + (fallback ? fallback.name : caps.first_name)),
      );
    }
  }

  const commissionPercent = Number(booking.commission_percent);
  const commissionAmountMinor = Math.round((finalMinor * commissionPercent) / 100);

  return {
    finalAmountMinor: finalMinor,
    commissionAmountMinor,
    providerEarningMinor: finalMinor - commissionAmountMinor,
    changedFromQuote: finalMinor !== quoted,
  };
}

/**
 * Issues the completion code to the customer. The provider asks for this when
 * the work is done; the customer reads the code back, which is what proves the
 * job actually happened.
 */
export async function requestCompletionCode(bookingId, actor, { finalAmountMinor } = {}) {
  const booking = await repo.findById(bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');
  assertParticipant(booking, actor);

  if (booking.status !== S.IN_PROGRESS) {
    throw ApiError.conflict(
      'A ' + sm.humanise(booking.status) + ' job cannot be completed. Start the job first.',
    );
  }

  const amounts = await settleAmounts(booking, finalAmountMinor);
  const code = numericOtp(6);
  const codeHash = await bcrypt.hash(code, 8);

  await withTransaction((tx) =>
    repo.applyTransition(tx, bookingId, {
      status: S.IN_PROGRESS,
      patch: { completionOtpHash: codeHash },
    }),
  );

  // The completion code goes by email like every other code. It carries the
  // amount payable, because reading it out is consent to that figure as well
  // as to the work.
  const content = otpEmail({
    purpose: 'complete_job',
    code,
    extra:
      'Amount payable for booking ' + booking.reference + ': <strong>' +
      money.format(amounts.finalAmountMinor) + '</strong>' +
      (amounts.changedFromQuote ? ' (revised from the original quote).' : '.'),
  });

  notifyAsync({
    userId: booking.customer_id,
    channel: 'email',
    destination: booking.customer_email,
    eventType: 'booking.completion_code',
    title: content.subject,
    body: 'Your completion code was sent by email.',
    email: content,
    entityType: 'booking',
    entityId: bookingId,
  });

  broadcast(booking, 'booking.completion_requested', {
    finalAmountMinor: amounts.finalAmountMinor,
    changedFromQuote: amounts.changedFromQuote,
  });

  return {
    sent: true,
    channel: 'email',
    destination: booking.customer_email,
    amount: {
      finalMinor: amounts.finalAmountMinor,
      final: money.toMajor(amounts.finalAmountMinor),
      changedFromQuote: amounts.changedFromQuote,
    },
    // Returned only when no mail server is configured and nothing was really
    // sent. With SMTP live, a provider could otherwise read the customer's
    // completion code straight out of their own API response - which is
    // exactly the confirmation the code exists to prevent.
    devCode: codeCanBeEchoed() ? code : undefined,
  };
}

/**
 * Completes the job.
 *
 * A provider must present the customer's code. A customer completing their own
 * booking needs no code - they are the party the code exists to protect.
 */
export async function completeJob(bookingId, actor, { otp, finalAmountMinor, photos = [] } = {}) {
  const booking = await repo.findById(bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');
  assertParticipant(booking, actor);

  if (booking.status !== S.IN_PROGRESS) {
    throw ApiError.conflict('A ' + sm.humanise(booking.status) + ' job cannot be completed');
  }

  if (actor.type === 'provider') {
    if (!otp) {
      throw ApiError.badRequest('Ask the customer for their completion code, then enter it here');
    }

    const stored = await queryOne(
      'SELECT completion_otp_hash FROM bookings WHERE id = $1',
      [bookingId],
    );

    if (!stored || !stored.completion_otp_hash) {
      throw ApiError.badRequest('Request a completion code first');
    }

    if (!(await bcrypt.compare(String(otp), stored.completion_otp_hash))) {
      throw ApiError.badRequest('That completion code is not correct');
    }
  }

  const amounts = await settleAmounts(booking, finalAmountMinor);
  const bookingConfig = await settings.get('booking');
  const disputeWindowEndsAt = new Date(
    Date.now() + (bookingConfig.disputeWindowHours ?? 48) * 3600000,
  );

  await transition({
    bookingId,
    to: S.COMPLETED,
    actor,
    reason: 'Job completed',
    patch: {
      completedAt: new Date(),
      finalAmountMinor: amounts.finalAmountMinor,
      commissionAmountMinor: amounts.commissionAmountMinor,
      providerEarningMinor: amounts.providerEarningMinor,
      disputeWindowEndsAt,
    },
  });

  if (photos.length) {
    await withTransaction((tx) =>
      tx.query('UPDATE bookings SET completion_photos = $2 WHERE id = $1', [bookingId, photos]),
    );
  }

  await withTransaction((tx) =>
    tx.query(
      'UPDATE provider_profiles SET jobs_completed = jobs_completed + 1 WHERE id = $1',
      [booking.provider_id],
    ),
  );

  const completed = await repo.findById(bookingId);
  broadcast(completed, 'booking.completed', {
    finalAmountMinor: amounts.finalAmountMinor,
    disputeWindowEndsAt,
  });

  /**
   * By email, not only in the app.
   *
   * This is the message that asks for money. Left as an in-app notice it
   * reached nobody who was not already looking at the site, which is most
   * people once the professional has packed up and gone.
   */
  notifyAllAsync({
    userId: completed.customer_id,
    actionLabel: 'Pay for this job',
    actionPath: '/bookings/' + bookingId,
    eventType: 'booking.completed',
    title: 'Job completed',
    body:
      'Booking ' + completed.reference + ' is complete. Amount payable ' +
      money.format(amounts.finalAmountMinor) + '. You can rate your provider now.',
    entityType: 'booking',
    entityId: bookingId,
  });

  notifyAllAsync({
    userId: completed.provider_user_id,
    actionLabel: 'See your earnings',
    actionPath: '/provider/earnings',
    eventType: 'booking.completed',
    title: 'Job marked complete',
    body:
      'Booking ' + completed.reference + ' is complete. Your earning of ' +
      money.format(amounts.providerEarningMinor) +
      ' will be released once the dispute window closes.',
    entityType: 'booking',
    entityId: bookingId,
  });

  return present(completed, { viewerRole: actor.type });
}

// ---------------------------------------------------------------- live view

/**
 * The tracking view a customer watches while a job is under way. Deliberately
 * small - it is polled, and pushed on every transition.
 */
export async function trackingState(bookingId, actor) {
  const booking = await repo.findById(bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');
  assertParticipant(booking, actor);

  const history = await repo.history(bookingId);

  const STEPS = [S.REQUESTED, S.ACCEPTED, S.IN_PROGRESS, S.COMPLETED];
  const reached = new Map(history.map((h) => [h.to_status, h.created_at]));
  const currentIndex = STEPS.indexOf(booking.status);

  return {
    bookingId: booking.id,
    reference: booking.reference,
    status: booking.status,
    statusLabel: sm.humanise(booking.status),
    isLive: sm.isLive(booking.status),
    // The progress bar the customer sees. A branch state (cancelled, rejected)
    // leaves currentIndex at -1, which the UI renders as a stopped timeline.
    steps: STEPS.map((step, index) => ({
      status: step,
      label: sm.humanise(step),
      reached: reached.has(step),
      at: reached.get(step) ?? null,
      // "Current" means the job is still sitting at this step, not merely
      // that this was the last step reached. Completed is the end of the
      // journey, so marking it current left a finished booking showing a
      // hollow marker and "Happening now" against work that was already
      // paid for and done.
      current: booking.status === step && sm.isLive(booking.status),
      upcoming: currentIndex >= 0 && index > currentIndex,
    })),
    branchedTo: currentIndex === -1 ? booking.status : null,
    scheduledStart: booking.scheduled_start,
    startedAt: booking.started_at,
    completedAt: booking.completed_at,
    disputeWindowEndsAt: booking.dispute_window_ends_at,
    provider: {
      name: booking.provider_business_name || booking.provider_name,
      phone: sm.isLive(booking.status) && booking.status !== S.REQUESTED ? booking.provider_phone : null,
    },
    amount: {
      quotedMinor: booking.quoted_amount_minor,
      finalMinor: booking.final_amount_minor,
    },
  };
}

// ---------------------------------------------------------------- escalation

/**
 * Finds jobs that have gone quiet, for the reminder worker in Phase 12.
 *
 * Two cases matter: a job accepted but never started well past its slot, and
 * a job started but never completed. Both usually mean somebody forgot to tap
 * a button, and both block the provider getting paid.
 */
export async function findStalledJobs() {
  const { queryMany } = await import('../../db/pool.js');

  const notStarted = await queryMany(
    `SELECT b.id, b.reference, b.customer_id, b.scheduled_start, p.user_id AS provider_user_id
       FROM bookings b
       JOIN provider_profiles p ON p.id = b.provider_id
      WHERE b.status = 'accepted'
        AND b.scheduled_start < NOW() - INTERVAL '2 hours'
      ORDER BY b.scheduled_start
      LIMIT 100`,
  );

  const notCompleted = await queryMany(
    `SELECT b.id, b.reference, b.customer_id, b.started_at, p.user_id AS provider_user_id
       FROM bookings b
       JOIN provider_profiles p ON p.id = b.provider_id
      WHERE b.status = 'in_progress'
        AND b.started_at < NOW() - INTERVAL '12 hours'
      ORDER BY b.started_at
      LIMIT 100`,
  );

  return {
    notStarted: notStarted.map((b) => ({
      id: b.id,
      reference: b.reference,
      scheduledStart: b.scheduled_start,
      providerUserId: b.provider_user_id,
      customerId: b.customer_id,
      issue: 'accepted_but_not_started',
    })),
    notCompleted: notCompleted.map((b) => ({
      id: b.id,
      reference: b.reference,
      startedAt: b.started_at,
      providerUserId: b.provider_user_id,
      customerId: b.customer_id,
      issue: 'started_but_not_completed',
    })),
  };
}

/** Nudges both sides of every stalled job. Idempotent enough to run hourly. */
export async function nudgeStalledJobs() {
  const { notStarted, notCompleted } = await findStalledJobs();

  for (const job of notStarted) {
    notifyAllAsync({
      userId: job.providerUserId,
      actionLabel: 'Open the job',
      actionPath: '/provider/jobs/' + job.id,
      eventType: 'booking.not_started',
      title: 'Did you attend this job?',
      body:
        'Booking ' + job.reference + ' was scheduled for ' +
        new Date(job.scheduledStart).toLocaleString('en-IN') +
        ' and has not been started. Start it or cancel so the customer knows.',
      entityType: 'booking',
      entityId: job.id,
    });
  }

  for (const job of notCompleted) {
    notifyAllAsync({
      userId: job.providerUserId,
      actionLabel: 'Open the job',
      actionPath: '/provider/jobs/' + job.id,
      eventType: 'booking.not_completed',
      title: 'Is this job finished?',
      body:
        'Booking ' + job.reference + ' has been in progress since ' +
        new Date(job.startedAt).toLocaleString('en-IN') +
        '. Mark it complete to get paid.',
      entityType: 'booking',
      entityId: job.id,
    });
  }

  return { nudged: notStarted.length + notCompleted.length, notStarted: notStarted.length, notCompleted: notCompleted.length };
}

export default {
  startJob, requestCompletionCode, completeJob, trackingState,
  findStalledJobs, nudgeStalledJobs,
};
