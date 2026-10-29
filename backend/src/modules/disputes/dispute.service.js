/**
 * Disputes.
 *
 * A dispute is the one place where the platform overrides what the two parties
 * recorded between themselves, so every decision is attributable, the money
 * consequence is explicit, and the booking's own state machine still governs
 * what the booking can become.
 */
import { withTransaction } from '../../db/pool.js';
import ApiError from '../../utils/ApiError.js';
import { BOOKING_STATUS as S } from '../../config/constants.js';
import { reference, money } from '../../utils/helpers.js';
import { notifyAllAsync } from '../../services/notification.service.js';
import * as bookingRepo from '../bookings/booking.repository.js';
import { transition, assertParticipant } from '../bookings/booking.service.js';
import { refund as issueRefund } from '../payments/payment.service.js';
import * as repo from './dispute.repository.js';

function present(d, { viewerRole = 'customer' } = {}) {
  const base = {
    id: d.id,
    reference: d.reference,
    status: d.status,
    priority: d.priority,
    category: d.category,
    subject: d.subject,
    description: d.description,
    evidence: d.evidence ?? [],
    booking: {
      id: d.booking_id,
      reference: d.booking_reference,
      categoryName: d.category_name,
      status: d.booking_status,
      finalAmountMinor: d.final_amount_minor === undefined ? undefined : Number(d.final_amount_minor),
    },
    raisedByType: d.raised_by_type,
    resolution: d.resolved_at
      ? {
          type: d.resolution_type,
          notes: d.resolution,
          refundAmountMinor: d.refund_amount_minor === null ? null : Number(d.refund_amount_minor),
          at: d.resolved_at,
        }
      : null,
    createdAt: d.created_at,
  };

  if (viewerRole === 'admin') {
    return {
      ...base,
      parties: {
        customer: { id: d.customer_id, name: d.customer_name, phone: d.customer_phone },
        provider: { id: d.provider_id, name: d.provider_business_name || d.provider_name },
      },
      assignedTo: d.assigned_to ? { id: d.assigned_to, name: d.assigned_to_name } : null,
      disputeWindowEndsAt: d.dispute_window_ends_at,
    };
  }

  return {
    ...base,
    customerName: d.customer_name,
    providerName: d.provider_business_name || d.provider_name,
  };
}

/**
 * Raising a dispute moves the booking out of completed, which is what holds
 * the provider's payout while the platform looks into it.
 */
export async function raise(bookingId, actor, payload) {
  const booking = await bookingRepo.findById(bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');
  assertParticipant(booking, actor);

  if (booking.status !== S.COMPLETED) {
    throw ApiError.conflict(
      'Only a completed booking can be disputed. This one is ' + booking.status.replace('_', ' ') + '.',
    );
  }

  if (booking.dispute_window_ends_at && new Date(booking.dispute_window_ends_at) < new Date()) {
    throw ApiError.conflict(
      'The dispute window for this booking closed on ' +
        new Date(booking.dispute_window_ends_at).toLocaleString('en-IN'),
    );
  }

  const open = await repo.findOpenForBooking(bookingId);
  if (open) throw ApiError.conflict('A dispute is already open on this booking');

  const dispute = await withTransaction(async (tx) => {
    const created = await repo.create(tx, {
      reference: reference('DSP'),
      bookingId,
      raisedBy: actor.id,
      raisedByType: actor.type,
      category: payload.category,
      subject: payload.subject,
      description: payload.description,
      evidence: payload.evidence ?? [],
      priority: payload.priority ?? 'normal',
    });

    return created;
  });

  // The booking transition runs through the same guard everything else does.
  await transition({
    bookingId,
    to: S.DISPUTED,
    actor,
    reason: 'Dispute raised: ' + payload.subject,
  });

  notifyAllAsync({
    userId: booking.provider_user_id,
    eventType: 'dispute.raised',
    title: 'A dispute was raised on your job',
    body:
      'Booking ' + booking.reference + ' is under review: ' + payload.subject +
      '. Your payout for this job is on hold until it is resolved.',
    actionLabel: 'See the dispute',
    actionPath: '/provider/jobs/' + bookingId,
    entityType: 'dispute',
    entityId: dispute.id,
  });

  // Re-read the joined row rather than spreading the booking over the dispute:
  // both carry `id` and `status`, and the spread silently overwrote the
  // dispute's own with the booking's.
  const full = await repo.findById(dispute.id);
  return present(full, { viewerRole: actor.type });
}

export async function getDispute(disputeId, actor) {
  const dispute = await repo.findById(disputeId);
  if (!dispute) throw ApiError.notFound('Dispute not found');

  const isAdmin = actor.type === 'admin';
  const isParty =
    (actor.type === 'customer' && dispute.customer_id === actor.id) ||
    (actor.type === 'provider' && dispute.provider_id === actor.providerId);

  if (!isAdmin && !isParty) throw ApiError.forbidden('You do not have access to this dispute');

  const thread = await repo.messages(disputeId, { includeInternal: isAdmin });

  return {
    ...present(dispute, { viewerRole: actor.type }),
    messages: thread.map((m) => ({
      id: m.id,
      authorType: m.author_type,
      authorName: m.author_name,
      message: m.message,
      attachments: m.attachments ?? [],
      isInternal: m.is_internal,
      at: m.created_at,
    })),
  };
}

export async function addMessage(disputeId, actor, { message, attachments, isInternal }) {
  const dispute = await repo.findById(disputeId);
  if (!dispute) throw ApiError.notFound('Dispute not found');

  const isAdmin = actor.type === 'admin';
  const isParty =
    (actor.type === 'customer' && dispute.customer_id === actor.id) ||
    (actor.type === 'provider' && dispute.provider_id === actor.providerId);

  if (!isAdmin && !isParty) throw ApiError.forbidden('You do not have access to this dispute');

  if (dispute.resolved_at) {
    throw ApiError.conflict('This dispute is closed');
  }

  // Only an admin can leave a note the parties cannot see.
  const created = await repo.addMessage(disputeId, {
    authorId: actor.id,
    authorType: actor.type,
    message,
    attachments,
    isInternal: isAdmin ? Boolean(isInternal) : false,
  });

  return {
    id: created.id,
    authorType: created.author_type,
    message: created.message,
    isInternal: created.is_internal,
    at: created.created_at,
  };
}

// ---------------------------------------------------------------- admin

export async function listDisputes(filters, actor) {
  /**
   * Scoped by who the dispute is *about*, not by who typed it.
   *
   * Filtering on raised_by meant a provider could never list a dispute a
   * customer had raised against them - the one whose payout is frozen could
   * not find the case. getDispute already let them read it by id; only the
   * listing disagreed.
   */
  const scope =
    actor.type === 'admin'
      ? filters
      : actor.type === 'provider'
        ? { ...filters, partyProviderId: actor.providerId }
        : { ...filters, partyCustomerId: actor.id };
  const { items, total } = await repo.list(scope);
  return { items: items.map((d) => present(d, { viewerRole: actor.type })), total };
}

export async function counts() {
  const row = await repo.counts();
  return {
    open: row.open,
    underReview: row.under_review,
    awaitingResponse: row.awaiting_response,
    resolved: row.resolved,
    rejected: row.rejected,
    // Unresolved for more than three days - the number an ops lead watches.
    overdue: row.overdue,
  };
}

export async function assign(disputeId, adminId) {
  const assigned = await repo.assign(disputeId, adminId);
  if (!assigned) throw ApiError.notFound('Dispute not found');
  return present(assigned, { viewerRole: 'admin' });
}

/**
 * Resolves a dispute and carries out the money consequence.
 *
 * The refund and the booking transition happen through the same services the
 * rest of the platform uses, so a dispute refund appears in the ledger and the
 * status history exactly like any other - there is no side door.
 */
export async function resolve(disputeId, adminId, payload) {
  const dispute = await repo.findById(disputeId);
  if (!dispute) throw ApiError.notFound('Dispute not found');
  if (dispute.resolved_at) throw ApiError.conflict('This dispute has already been resolved');

  const { resolutionType, resolution, refundAmountMinor } = payload;
  const refunding = ['full_refund', 'partial_refund'].includes(resolutionType);

  if (resolutionType === 'partial_refund' && !refundAmountMinor) {
    throw ApiError.badRequest('A partial refund needs an amount');
  }

  let refundResult = null;

  if (refunding) {
    // Issued first: if the gateway refuses, the dispute stays open rather than
    // being marked resolved with money that never moved.
    refundResult = await issueRefund({
      bookingId: dispute.booking_id,
      amountMinor: resolutionType === 'partial_refund' ? refundAmountMinor : undefined,
      reason: 'Dispute ' + dispute.reference + ': ' + resolution,
      initiatedBy: 'admin',
      adminId,
    });
  }

  await withTransaction((tx) =>
    repo.resolve(tx, disputeId, {
      status: 'resolved',
      resolution,
      resolutionType,
      refundAmountMinor: refundResult ? refundResult.amountMinor : null,
      resolvedBy: adminId,
    }),
  );

  // A fully refunded booking ends as refunded; anything else returns to
  // completed, because the work was in fact done.
  const nextStatus =
    resolutionType === 'full_refund' ? S.REFUNDED : S.COMPLETED;

  await transition({
    bookingId: dispute.booking_id,
    to: nextStatus,
    actor: { type: 'admin', id: adminId },
    reason: 'Dispute resolved: ' + resolutionType.replace('_', ' '),
  });

  const outcomeText = {
    full_refund: 'You have been refunded in full.',
    partial_refund: refundResult
      ? money.format(refundResult.amountMinor) + ' has been refunded to you.'
      : 'A partial refund has been issued.',
    no_refund: 'After review, no refund has been issued.',
    rework: 'The provider will return to complete the work.',
    warning_issued: 'We have issued a warning to the provider.',
  }[resolutionType];

  notifyAllAsync({
    userId: dispute.customer_id,
    actionLabel: 'See the outcome',
    actionPath: '/bookings/' + dispute.booking_id,
    eventType: 'dispute.resolved',
    title: 'Your dispute has been resolved',
    body: 'Dispute ' + dispute.reference + ': ' + outcomeText,
    entityType: 'dispute',
    entityId: disputeId,
  });

  notifyAllAsync({
    userId: dispute.provider_user_id,
    actionLabel: 'See the outcome',
    actionPath: '/provider/jobs/' + dispute.booking_id,
    eventType: 'dispute.resolved',
    title: 'A dispute on your job has been resolved',
    body:
      'Dispute ' + dispute.reference + ' was resolved as ' + resolutionType.replace('_', ' ') +
      '. ' + resolution,
    entityType: 'dispute',
    entityId: disputeId,
  });

  return {
    dispute: present(await repo.findById(disputeId), { viewerRole: 'admin' }),
    refund: refundResult,
    bookingStatus: nextStatus,
  };
}

/** Rejecting a dispute leaves the booking completed and the payout on track. */
export async function reject(disputeId, adminId, { resolution }) {
  const dispute = await repo.findById(disputeId);
  if (!dispute) throw ApiError.notFound('Dispute not found');
  if (dispute.resolved_at) throw ApiError.conflict('This dispute has already been closed');

  await withTransaction((tx) =>
    repo.resolve(tx, disputeId, {
      status: 'rejected',
      resolution,
      resolutionType: 'no_refund',
      refundAmountMinor: null,
      resolvedBy: adminId,
    }),
  );

  await transition({
    bookingId: dispute.booking_id,
    to: S.COMPLETED,
    actor: { type: 'admin', id: adminId },
    reason: 'Dispute rejected: ' + resolution,
  });

  notifyAllAsync({
    userId: dispute.customer_id,
    actionLabel: 'See the decision',
    actionPath: '/bookings/' + dispute.booking_id,
    eventType: 'dispute.rejected',
    title: 'Your dispute was not upheld',
    body: 'Dispute ' + dispute.reference + ': ' + resolution,
    entityType: 'dispute',
    entityId: disputeId,
  });

  return present(await repo.findById(disputeId), { viewerRole: 'admin' });
}

export default {
  raise, getDispute, addMessage, listDisputes, counts, assign, resolve, reject,
};
