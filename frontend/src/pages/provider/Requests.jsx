import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';
import { api } from '../../lib/api.js';
import { keys } from '../../lib/queryClient.js';
import BookingCard from '../../components/BookingCard.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { SkeletonCard } from '../../components/ui/Skeleton.jsx';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import PageHeader from '../../components/ui/PageHeader.jsx';

const FILTERS = {
  new: ['requested'],
  scheduled: ['accepted'],
  active: ['in_progress'],
  done: ['completed'],
  closed: ['cancelled', 'rejected', 'disputed', 'refunded'],
};

export default function Requests() {
  useDocumentTitle('Jobs');
  const [tab, setTab] = useState('new');
  const [page, setPage] = useState(1);

  const { data: counts } = useQuery({
    queryKey: keys.bookings.counts,
    queryFn: async () => (await api.get('/bookings/counts')).data,
  });

  const { data, isLoading } = useQuery({
    queryKey: keys.bookings.list({ tab, page, view: 'provider' }),
    queryFn: () => api.get('/bookings', { params: { status: FILTERS[tab], page, limit: 10 } }),
  });

  const bookings = data?.data ?? [];
  const meta = data?.meta ?? {};

  const tabs = [
    { value: 'new', label: 'New', count: counts?.requested },
    { value: 'scheduled', label: 'Scheduled', count: counts?.accepted },
    { value: 'active', label: 'In progress', count: counts?.inProgress },
    { value: 'done', label: 'Completed', count: counts?.completed },
    { value: 'closed', label: 'Closed' },
  ];

  return (
    <div className="page max-w-4xl py-5 sm:py-7">
      <PageHeader icon={Inbox} title="Jobs" />

      <Tabs
        className="mt-4"
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
            icon={Inbox}
            title={tab === 'new' ? 'No new requests' : 'Nothing here'}
            description={
              tab === 'new'
                ? 'When a customer books you, it appears here first. Respond quickly - your acceptance rate affects where you rank in search.'
                : undefined
            }
          />
        ) : (
          bookings.map((booking) => (
            <BookingCard
              key={booking.id}
              booking={booking}
              perspective="provider"
              to={'/provider/jobs/' + booking.id}
            />
          ))
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
