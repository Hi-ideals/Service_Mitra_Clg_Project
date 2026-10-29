import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarRange } from 'lucide-react';
import { api } from '../../lib/api.js';
import Card, { CardBody } from '../../components/ui/Card.jsx';
import Badge, { BOOKING_STATUS_VARIANT } from '../../components/ui/Badge.jsx';
import Select from '../../components/ui/Select.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { PageLoader } from '../../components/ui/Spinner.jsx';
import { money, formatDateTime } from '../../lib/format.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import PageHeader from '../../components/ui/PageHeader.jsx';

/** Grouped the way an agency owner thinks about the week, not by enum order. */
const GROUPS = [
  { value: '', label: 'All' },
  { value: 'requested', label: 'Awaiting reply' },
  { value: 'accepted', label: 'Upcoming' },
  { value: 'in_progress', label: 'Running now' },
  { value: 'completed', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
];

const LIMIT = 20;

export default function AgencyJobs() {
  useDocumentTitle('Jobs');

  const [status, setStatus] = useState('');
  const [providerId, setProviderId] = useState('');
  const [page, setPage] = useState(1);

  const { data: team } = useQuery({
    queryKey: ['agency', 'team'],
    queryFn: async () => (await api.get('/agencies/me/providers')).data,
  });

  const params = {
    page,
    limit: LIMIT,
    ...(status ? { status } : {}),
    ...(providerId ? { providerId } : {}),
  };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['agency', 'jobs', params],
    queryFn: () => api.get('/agencies/me/bookings', { params }),
    placeholderData: (previous) => previous,
  });

  if (isLoading) return <PageLoader label="Loading jobs" />;

  const jobs = data?.data ?? [];
  const total = data?.meta?.total ?? 0;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader icon={CalendarRange} title="Jobs" description="Everything your team has been booked for." />

      <Tabs
        className="mt-4"
        value={status}
        onChange={(v) => {
          setStatus(v);
          setPage(1);
        }}
        tabs={GROUPS}
      />

      {team?.length > 1 && (
        <div className="mt-3 max-w-xs">
          <Select
            label="Person"
            value={providerId}
            onChange={(e) => {
              setProviderId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Everyone</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      <Card className="mt-4">
        <CardBody className={jobs.length ? 'p-0' : undefined}>
          {jobs.length === 0 ? (
            <EmptyState
              compact
              icon={CalendarRange}
              title="Nothing here"
              description="No jobs match that filter."
            />
          ) : (
            <ul className={'divide-y divide-ink-200' + (isFetching ? ' opacity-60 transition-opacity' : '')}>
              {jobs.map((j) => (
                <li key={j.id} className="row-hover flex items-start justify-between gap-3 px-4 py-3.5 sm:px-5">
                  <div className="min-w-0">
                    <p className="font-medium text-ink-900">{j.service}</p>
                    <p className="mt-0.5 text-sm text-ink-500">
                      {j.providerName} · for {j.customerName}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-400">
                      {formatDateTime(j.scheduledStart)}
                      {j.city && ' · ' + j.city}
                      {' · '}
                      <span className="font-mono">{j.reference}</span>
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold tabular-nums text-ink-900">
                      {money(j.amountMinor / 100)}
                    </p>
                    <Badge variant={BOOKING_STATUS_VARIANT[j.status]} size="sm" className="mt-1">
                      {j.status.replace('_', ' ')}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {total > LIMIT && (
        <Pagination
          className="mt-4"
          page={page}
          total={total}
          totalPages={Math.ceil(total / LIMIT)}
          onChange={setPage}
        />
      )}

      <p className="mt-4 px-1 text-xs text-ink-400">
        Amounts are what the customer pays. Each person is paid their own share directly.
      </p>
    </div>
  );
}
