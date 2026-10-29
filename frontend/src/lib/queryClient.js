import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api.js';

/**
 * Server state configuration.
 *
 * The defaults are tuned for a marketplace: catalogue data barely changes and
 * is cached hard, while anything about a live booking is refetched on focus
 * because a stale job status is actively misleading.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // Retrying a 403 or a 422 just repeats the same refusal.
        if (error instanceof ApiError) {
          if (error.status >= 400 && error.status < 500) return false;
        }
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
    mutations: {
      // A mutation is a user action; silently retrying one could double-book.
      retry: false,
    },
  },
});

/** Query keys in one place, so an invalidation cannot miss a cache by typo. */
export const keys = {
  me: ['me'],
  categories: {
    all: ['categories'],
    tree: ['categories', 'tree'],
    detail: (idOrSlug) => ['categories', idOrSlug],
  },
  providers: {
    search: (filters) => ['providers', 'search', filters],
    profile: (id) => ['providers', id],
    featured: (city) => ['providers', 'featured', city],
    reviews: (id, filters) => ['providers', id, 'reviews', filters],
    me: ['providers', 'me'],
    schedule: ['providers', 'me', 'schedule'],
  },
  bookings: {
    list: (filters) => ['bookings', filters],
    detail: (id) => ['bookings', id],
    tracking: (id) => ['bookings', id, 'tracking'],
    counts: ['bookings', 'counts'],
  },
  addresses: ['addresses'],
  kyc: { me: ['kyc', 'me'], queue: (filters) => ['admin', 'kyc', filters] },
  payments: { forBooking: (id) => ['payments', 'booking', id] },
  invoices: { list: (filters) => ['invoices', filters], detail: (id) => ['invoices', id] },
  earnings: (filters) => ['earnings', filters],
  reviews: {
    mine: ['reviews', 'mine'],
    pending: ['reviews', 'pending'],
    received: ['reviews', 'received'],
  },
  disputes: { list: (filters) => ['disputes', filters], detail: (id) => ['disputes', id] },
  admin: {
    peopleSummary: ['admin', 'people', 'summary'],
    people: (filters) => ['admin', 'people', filters],
    dashboard: (range) => ['admin', 'analytics', 'dashboard', range],
    series: (range) => ['admin', 'analytics', 'series', range],
    backup: ['admin', 'backup', 'summary'],
    audit: (filters) => ['admin', 'audit', filters],
    auditFilters: ['admin', 'audit', 'filters'],
    settings: ['admin', 'settings'],
    payouts: (filters) => ['admin', 'payouts', filters],
  },
};

export default queryClient;
