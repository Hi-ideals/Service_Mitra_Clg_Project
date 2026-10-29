/**
 * Platform analytics.
 *
 * Amounts are returned in both paise and rupees so a dashboard never does
 * currency arithmetic in JavaScript, and rates are pre-computed server-side
 * so two different charts cannot disagree about the same number.
 */
import { money } from '../../utils/helpers.js';
import * as repo from './analytics.repository.js';

/** Resolves a date range, defaulting to the last 30 days. */
function resolveRange({ from, to }) {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 30 * 86400000);
  return { from: start.toISOString(), to: end.toISOString(), days: Math.round((end - start) / 86400000) };
}

const asMoney = (minor) => ({ minor: Number(minor), value: money.toMajor(minor) });

export async function dashboard(range) {
  const { from, to, days } = resolveRange(range);

  const [overview, totals, funnel, retention, payments] = await Promise.all([
    repo.overview({ from, to }),
    repo.platformTotals(),
    repo.funnel({ from, to }),
    repo.retention({ from, to }),
    repo.paymentHealth({ from, to }),
  ]);

  const netRevenue = Number(overview.gross_revenue) - Number(payments.refunded_amount);

  return {
    range: { from, to, days },
    bookings: {
      total: overview.total_bookings,
      completed: overview.completed,
      cancelled: overview.cancelled,
      rejected: overview.rejected,
      live: overview.live,
      completionRate: overview.total_bookings
        ? Number(((overview.completed / overview.total_bookings) * 100).toFixed(1))
        : 0,
      cancellationRate: overview.total_bookings
        ? Number(((overview.cancelled / overview.total_bookings) * 100).toFixed(1))
        : 0,
    },
    revenue: {
      // Collected, not merely completed. A finished job the customer has not
      // paid for is a receivable, reported separately below.
      gross: asMoney(overview.gross_revenue),
      // What the platform actually keeps, after refunds.
      commission: asMoney(overview.commission),
      refunded: asMoney(payments.refunded_amount),
      net: asMoney(netRevenue),
      averageOrderValue: asMoney(overview.average_order_value),
      awaitingPayment: asMoney(overview.awaiting_payment),
      awaitingPaymentCount: overview.awaiting_payment_count,
    },
    marketplace: {
      customers: totals.customers,
      providers: totals.providers,
      verifiedProviders: totals.verified_providers,
      liveProviders: totals.live_providers,
      activeCustomers: overview.active_customers,
      activeProviders: overview.active_providers,
      activeCategories: totals.active_categories,
    },
    // The queues an admin needs to clear, surfaced as badge counts.
    attention: {
      pendingKyc: totals.pending_kyc,
      openDisputes: totals.open_disputes,
      flaggedReviews: totals.flagged_reviews,
    },
    funnel: {
      requested: funnel.requested,
      accepted: funnel.accepted,
      started: funnel.started,
      completed: funnel.completed,
      acceptanceRate: funnel.requested
        ? Number(((funnel.accepted / funnel.requested) * 100).toFixed(1))
        : 0,
      dropOff: {
        rejected: funnel.rejected,
        cancelledByCustomer: funnel.cancelled_by_customer,
        cancelledByProvider: funnel.cancelled_by_provider,
        expired: funnel.expired,
      },
      avgResponseMinutes: funnel.avg_response_minutes,
    },
    retention: {
      customers: retention.customers,
      repeatCustomers: retention.repeat_customers,
      repeatRate: Number(retention.repeat_rate),
      bookingsPerCustomer: Number(retention.bookings_per_customer),
    },
    payments: {
      attempts: payments.attempts,
      succeeded: payments.succeeded,
      failed: payments.failed,
      pending: payments.pending,
      successRate: Number(payments.success_rate),
    },
  };
}

export async function series(range, granularity = 'day') {
  const { from, to } = resolveRange(range);
  const rows = await repo.timeSeries({ from, to, granularity });

  return {
    granularity,
    points: rows.map((r) => ({
      period: r.period,
      bookings: r.bookings,
      completed: r.completed,
      cancelled: r.cancelled,
      revenue: asMoney(r.revenue),
      commission: asMoney(r.commission),
    })),
  };
}

export async function categories(range, limit = 10) {
  const { from, to } = resolveRange(range);
  const rows = await repo.topCategories({ from, to, limit });

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    bookings: r.bookings,
    completed: r.completed,
    revenue: asMoney(r.revenue),
    averageValue: asMoney(r.average_value),
  }));
}

export async function locations(range, limit = 10) {
  const { from, to } = resolveRange(range);
  const rows = await repo.topLocations({ from, to, limit });

  return rows.map((r) => ({
    city: r.city,
    state: r.state,
    bookings: r.bookings,
    completed: r.completed,
    revenue: asMoney(r.revenue),
  }));
}

export async function providers(range, { limit = 20, sort = 'revenue' } = {}) {
  const { from, to } = resolveRange(range);
  const rows = await repo.providerPerformance({ from, to, limit, sort });

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    rating: { average: Number(r.rating_average), count: r.rating_count },
    acceptanceRate: Number(r.acceptance_rate),
    bookings: r.bookings,
    completed: r.completed,
    cancelled: r.cancelled,
    completionRate: Number(r.completion_rate),
    revenue: asMoney(r.revenue),
    commission: asMoney(r.commission),
  }));
}

export default { dashboard, series, categories, locations, providers };
