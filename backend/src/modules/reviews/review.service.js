/**
 * Ratings and reviews.
 *
 * A review is only worth something if it is hard to fake, so eligibility is
 * narrow by design: the customer of a genuinely completed booking, once, within
 * a window. That constraint is what makes the rating a usable ranking signal
 * in discovery rather than decoration.
 */
import { withTransaction } from '../../db/pool.js';
import ApiError from '../../utils/ApiError.js';
import { BOOKING_STATUS as S } from '../../config/constants.js';
import { notifyAsync } from '../../services/notification.service.js';
import * as repo from './review.repository.js';

/** Reviews close after this long, so ratings reflect recent, recalled experience. */
const REVIEW_WINDOW_DAYS = 30;

/** Independent complaints needed before a review is raised for a human look. */
const AUTO_FLAG_THRESHOLD = 3;

function present(r, { viewerRole = 'public' } = {}) {
  const base = {
    id: r.id,
    bookingId: r.booking_id,
    rating: r.rating,
    title: r.title,
    comment: r.comment,
    subRatings: {
      punctuality: r.punctuality_rating,
      quality: r.quality_rating,
      behaviour: r.behaviour_rating,
    },
    photos: r.photos ?? [],
    customer: r.customer_name
      ? { name: r.customer_name, avatarUrl: r.customer_avatar ?? null }
      : undefined,
    provider: r.provider_business_name || r.provider_name
      ? { id: r.provider_id, name: r.provider_business_name || r.provider_name }
      : undefined,
    categoryName: r.category_name,
    bookingReference: r.booking_reference,
    reply: r.provider_reply
      ? { text: r.provider_reply, at: r.provider_replied_at }
      : null,
    createdAt: r.created_at,
  };

  // Moderation state is operational detail - customers and the public see the
  // review or they do not, they do not see why it was hidden.
  if (viewerRole === 'admin') {
    return {
      ...base,
      status: r.status,
      reportCount: r.report_count,
      moderationReason: r.moderation_reason,
      reports: r.reports ?? [],
    };
  }

  return base;
}

/**
 * Decides whether this customer may review this booking, and says precisely
 * why not when they may not.
 */
async function assertEligible(bookingId, customerId) {
  const booking = await repo.bookingForReview(bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');

  if (booking.customer_id !== customerId) {
    throw ApiError.forbidden('You can only review a booking you made');
  }

  if (booking.status !== S.COMPLETED) {
    throw ApiError.conflict(
      'You can review this booking once the job is complete. It is currently ' +
        booking.status.replace('_', ' ') + '.',
    );
  }

  const existing = await repo.findByBooking(bookingId);
  if (existing) {
    throw ApiError.conflict('You have already reviewed this booking');
  }

  const completedAt = new Date(booking.completed_at).getTime();
  const daysSince = (Date.now() - completedAt) / 86400000;

  if (daysSince > REVIEW_WINDOW_DAYS) {
    throw ApiError.conflict(
      'Reviews close ' + REVIEW_WINDOW_DAYS + ' days after a job is completed',
    );
  }

  return booking;
}

export async function createReview(bookingId, customerId, payload) {
  const booking = await assertEligible(bookingId, customerId);

  const { review, rating } = await withTransaction(async (tx) => {
    const created = await repo.create(tx, {
      bookingId,
      customerId,
      providerId: booking.provider_id,
      rating: payload.rating,
      title: payload.title ?? null,
      comment: payload.comment ?? null,
      punctualityRating: payload.punctuality ?? null,
      qualityRating: payload.quality ?? null,
      behaviourRating: payload.behaviour ?? null,
      photos: payload.photos ?? [],
    });

    // Recomputed in the same transaction, so discovery can never read a rating
    // that disagrees with the reviews behind it.
    const refreshed = await repo.refreshProviderRating(tx, booking.provider_id);
    return { review: created, rating: refreshed };
  });

  notifyAsync({
    userId: booking.provider_user_id,
    eventType: 'review.received',
    title: payload.rating >= 4 ? 'You received a good review' : 'You received a new review',
    body:
      'A customer rated your ' + booking.category_name + ' job ' + payload.rating +
      ' out of 5. You can reply to it from your dashboard.',
    entityType: 'review',
    entityId: review.id,
  });

  return {
    review: present(review),
    providerRating: {
      average: Number(rating.rating_average),
      count: rating.rating_count,
    },
  };
}

/** What the customer still owes a review on - drives the dashboard prompt. */
export async function pendingReviews(customerId, limit = 10) {
  const rows = await repo.awaitingReview(customerId, limit);
  return rows.map((b) => ({
    bookingId: b.id,
    reference: b.reference,
    categoryName: b.category_name,
    providerId: b.provider_id,
    providerName: b.business_name || b.provider_name,
    completedAt: b.completed_at,
    reviewCloses: new Date(
      new Date(b.completed_at).getTime() + REVIEW_WINDOW_DAYS * 86400000,
    ),
  }));
}

// ---------------------------------------------------------------- reads

export async function listForProvider(providerId, filters) {
  const [{ items, total }, breakdown] = await Promise.all([
    repo.listForProvider(providerId, filters),
    repo.ratingBreakdown(providerId),
  ]);

  const counts = {
    5: breakdown.five,
    4: breakdown.four,
    3: breakdown.three,
    2: breakdown.two,
    1: breakdown.one,
  };

  return {
    items: items.map((r) => present(r)),
    total,
    summary: {
      average: Number(breakdown.average),
      count: breakdown.total,
      // Percentages so the UI does not have to divide, and so an empty
      // provider renders an honest zero rather than NaN.
      distribution: Object.fromEntries(
        Object.entries(counts).map(([stars, n]) => [
          stars,
          { count: n, percent: breakdown.total ? Math.round((n / breakdown.total) * 100) : 0 },
        ]),
      ),
      subRatings: {
        punctuality: Number(breakdown.punctuality),
        quality: Number(breakdown.quality),
        behaviour: Number(breakdown.behaviour),
      },
    },
  };
}

export async function listForCustomer(customerId, filters) {
  const { items, total } = await repo.listForCustomer(customerId, filters);
  return { items: items.map((r) => present(r)), total };
}

// ---------------------------------------------------------------- provider reply

/**
 * A provider's right of reply. One reply per review, and only on their own
 * reviews - a reply is a response, not a running argument.
 */
export async function reply(reviewId, providerId, text) {
  const review = await repo.findById(reviewId);
  if (!review) throw ApiError.notFound('Review not found');

  if (review.provider_id !== providerId) {
    throw ApiError.forbidden('You can only reply to a review of your own work');
  }

  if (review.provider_reply) {
    throw ApiError.conflict('You have already replied to this review');
  }

  if (review.status !== 'published') {
    throw ApiError.conflict('This review is under moderation and cannot be replied to');
  }

  const updated = await repo.addReply(reviewId, providerId, text);

  notifyAsync({
    userId: review.customer_id,
    eventType: 'review.replied',
    title: 'The provider replied to your review',
    body: text.length > 140 ? text.slice(0, 137) + '...' : text,
    entityType: 'review',
    entityId: reviewId,
  });

  return present(updated);
}

// ---------------------------------------------------------------- moderation

export async function reportReview(reviewId, userId, payload) {
  const review = await repo.findById(reviewId);
  if (!review) throw ApiError.notFound('Review not found');

  const created = await repo.report(reviewId, userId, payload);

  // One person cannot report the same review twice to force a flag.
  if (!created) {
    return { reported: true, alreadyReported: true, status: review.status };
  }

  const updated = await repo.bumpReportCount(reviewId, AUTO_FLAG_THRESHOLD);

  return {
    reported: true,
    alreadyReported: false,
    reportCount: updated.report_count,
    // Flagging queues it for a human. It does not hide anything by itself -
    // otherwise three coordinated reports could silence an honest review.
    status: updated.status,
  };
}

export async function moderationQueue(filters) {
  const { items, total } = await repo.moderationQueue(filters);
  return { items: items.map((r) => present(r, { viewerRole: 'admin' })), total };
}

/**
 * The admin decision. Hiding or removing a review recomputes the provider's
 * rating immediately, so a fake five-star review stops helping the moment it
 * is taken down.
 */
export async function moderate(reviewId, adminId, { status, reason }) {
  const review = await repo.findById(reviewId);
  if (!review) throw ApiError.notFound('Review not found');

  if (!['published', 'hidden', 'removed'].includes(status)) {
    throw ApiError.badRequest('Status must be published, hidden or removed');
  }

  const result = await withTransaction(async (tx) => {
    const moderated = await repo.moderate(tx, reviewId, { status, adminId, reason });
    const rating = await repo.refreshProviderRating(tx, review.provider_id);
    return { moderated, rating };
  });

  if (status !== 'published') {
    notifyAsync({
      userId: review.customer_id,
      eventType: 'review.moderated',
      title: 'Your review was removed',
      body: reason || 'Your review did not meet our community guidelines.',
      entityType: 'review',
      entityId: reviewId,
    });
  }

  return {
    review: present(result.moderated, { viewerRole: 'admin' }),
    providerRating: {
      average: Number(result.rating.rating_average),
      count: result.rating.rating_count,
    },
  };
}

export { present, REVIEW_WINDOW_DAYS, AUTO_FLAG_THRESHOLD };

export default {
  createReview, pendingReviews, listForProvider, listForCustomer,
  reply, reportReview, moderationQueue, moderate,
};
