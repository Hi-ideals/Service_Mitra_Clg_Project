import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarX, Star, CalendarCheck } from 'lucide-react';
import { api } from '../../lib/api.js';
import { keys } from '../../lib/queryClient.js';
import BookingCard from '../../components/BookingCard.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Card, { CardBody } from '../../components/ui/Card.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { SkeletonCard } from '../../components/ui/Skeleton.jsx';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import PageHeader from '../../components/ui/PageHeader.jsx';

/** Groups the eight API statuses into the three a customer actually thinks in. */
const FILTERS = {
  upcoming: ['requested', 'accepted', 'in_progress'],
  completed: ['completed'],
  cancelled: ['cancelled', 'rejected', 'refunded', 'disputed'],
};

export default function MyBookings() {
  useDocumentTitle('My bookings');
  const [tab, setTab] = useState('upcoming');
  const [page, setPage] = useState(1);

  const { data: counts } = useQuery({
    queryKey: keys.bookings.counts,
    queryFn: async () => (await api.get('/bookings/counts')).data,
  });

  const { data, isLoading } = useQuery({
    queryKey: keys.bookings.list({ tab, page }),
    queryFn: () => api.get('/bookings', { params: { status: FILTERS[tab], page, limit: 10 } }),
  });

  // Bookings waiting on a review, so the prompt appears where the customer
  // already is rather than in a notification they will not open.
  const { data: pendingReviews } = useQuery({
    queryKey: keys.reviews.pending,
    queryFn: async () => (await api.get('/reviews/pending')).data,
  });

  const bookings = data?.data ?? [];
  const meta = data?.meta ?? {};

  const tabs = [
    {
      value: 'upcoming',
      label: 'Upcoming',
      count: counts ? counts.requested + counts.accepted + counts.inProgress : undefined,
    },
    { value: 'completed', label: 'Completed', count: counts?.completed },
    {
      value: 'cancelled',
      label: 'Cancelled',
      count: counts ? counts.cancelled + counts.rejected : undefined,
    },
  ];

  return (
    <div className="page max-w-4xl py-5 sm:py-7">
      <PageHeader
        icon={CalendarCheck}
        title="My bookings"
        action={
          <Button as={Link} to="/search" size="sm">
            Book a service
          </Button>
        }
      />

      {pendingReviews?.length > 0 && tab !== 'cancelled' && (
        <Card className="mt-4 border-accent-400/30 bg-accent-50">
          <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-2.5">
              <Star aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 fill-accent-400 text-accent-400" />
              <div>
                <p className="font-semibold text-ink-900">
                  {pendingReviews.length === 1
                    ? 'One job is waiting for your review'
                    : pendingReviews.length + ' jobs are waiting for your review'}
                </p>
                <p className="mt-0.5 text-sm text-ink-600">
                  Your rating is how other customers decide who to trust.
                </p>
              </div>
            </div>
            <Button as={Link} to={'/bookings/' + pendingReviews[0].bookingId} size="sm" className="shrink-0">
              Rate {pendingReviews[0].providerName}
            </Button>
          </CardBody>
        </Card>
      )}

      <Tabs
        className="mt-5"
        tabs={tabs}
        value={tab}
        onChange={(next) => {
          setTab(next);
          setPage(1);
        }}
      />

      <div className="mt-4 space-y-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
        ) : bookings.length === 0 ? (
          <EmptyState
            icon={CalendarX}
            title={
              tab === 'upcoming'
                ? 'No upcoming bookings'
                : tab === 'completed'
                  ? 'Nothing completed yet'
                  : 'Nothing cancelled'
            }
            description={
              tab === 'upcoming'
                ? 'Book a verified professional and it will appear here.'
                : undefined
            }
            action={tab === 'upcoming' ? <Button as={Link} to="/search">Find a professional</Button> : undefined}
          />
        ) : (
          bookings.map((booking) => <BookingCard key={booking.id} booking={booking} />)
        )}
      </div>

      <Pagination
        className="mt-6"
        page={meta.page || 1}
        totalPages={meta.totalPages}
        total={meta.total}
        onChange={setPage}
      />
    </div>
  );
}
