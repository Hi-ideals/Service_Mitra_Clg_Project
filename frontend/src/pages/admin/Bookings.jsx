import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarRange, Search, Ban } from 'lucide-react';
import { api } from '../../lib/api.js';
import { keys } from '../../lib/queryClient.js';
import useDebounce from '../../hooks/useDebounce.js';
import Card, { CardBody } from '../../components/ui/Card.jsx';
import Badge, { BOOKING_STATUS_VARIANT } from '../../components/ui/Badge.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import Input from '../../components/ui/Input.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { SkeletonCard } from '../../components/ui/Skeleton.jsx';
import { money, formatDateTime } from '../../lib/format.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import Alert from '../../components/ui/Alert.jsx';
import { useToast } from '../../context/ToastContext.jsx';

/**
 * The states an admin may still cancel out of.
 *
 * Mirrors the state machine rather than guessing: a request, an accepted job
 * and a job already under way can be cancelled; a completed, refunded or
 * already-cancelled one cannot, and offering a button that the server will
 * refuse is worse than offering none.
 *
 * Cancelling a job in progress is the admin's alone - neither side can do it -
 * which is the whole reason this control has to exist somewhere.
 */
const CANCELLABLE = new Set(['requested', 'accepted', 'in_progress']);

/**
 * Matches the server's minimum.
 *
 * A button that submits and is then refused teaches the person nothing except
 * to distrust the form.
 */
const MIN_REASON = 5;

const FILTERS = {
  all: undefined,
  live: ['requested', 'accepted', 'in_progress'],
  completed: ['completed'],
  problems: ['disputed', 'refunded'],
  closed: ['cancelled', 'rejected'],
};

export default function AdminBookings() {
  useDocumentTitle('All bookings');
  const [tab, setTab] = useState('live');
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const search = useDebounce(term, 400);
  const [cancelling, setCancelling] = useState(null);
  const [reason, setReason] = useState('');
  const toast = useToast();
  const queryClient = useQueryClient();

  const cancelBooking = useMutation({
    mutationFn: ({ id, why }) => api.post('/bookings/' + id + '/cancel', { reason: why }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'bookings'] });
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      setCancelling(null);
      setReason('');
      toast.success(result?.message ?? 'Booking cancelled');
    },
    onError: (e) => toast.error(e.message),
  });

  const { data, isLoading } = useQuery({
    queryKey: keys.bookings.list({ admin: true, tab, page, search }),
    queryFn: () =>
      api.get('/bookings', {
        params: { status: FILTERS[tab], search: search || undefined, page, limit: 20 },
      }),
  });

  const bookings = data?.data ?? [];
  const meta = data?.meta ?? {};

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader icon={CalendarRange} title="All bookings" description="Every booking on the platform." />

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          icon={Search}
          placeholder="Search by reference, customer, provider or service"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setPage(1);
          }}
          containerClassName="sm:max-w-md"
          aria-label="Search bookings"
        />
      </div>

      <Tabs
        className="mt-4"
        tabs={[
          { value: 'live', label: 'Live' },
          { value: 'completed', label: 'Completed' },
          { value: 'problems', label: 'Disputed' },
          { value: 'closed', label: 'Closed' },
          { value: 'all', label: 'Everything' },
        ]}
        value={tab}
        onChange={(next) => {
          setTab(next);
          setPage(1);
        }}
      />

      <Card className="mt-4">
        <CardBody className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : bookings.length === 0 ? (
            <EmptyState icon={CalendarRange} title="No bookings match this view" />
          ) : (
            <>
              {/* A table on desktop, stacked cards on a phone - a six-column
                  table at 375px is unreadable however it is styled. */}
              <div className="hidden overflow-x-auto lg:block">
                <table className="data-table w-full text-base">
                  <thead>
                    <tr>
                      <th scope="col">Reference</th>
                      <th scope="col">Service</th>
                      <th scope="col">Customer</th>
                      <th scope="col">Provider</th>
                      <th scope="col">When</th>
                      <th scope="col">Status</th>
                      <th scope="col" className="text-right">Amount</th>
                      <th scope="col" className="text-right">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-200">
                    {bookings.map((booking) => (
                      <tr key={booking.id}>
                        <td className="font-mono text-sm text-ink-500">{booking.reference}</td>
                        <td className="font-medium text-ink-900">{booking.category.name}</td>
                        <td className="text-ink-600">{booking.customer.name}</td>
                        <td className="text-ink-600">{booking.provider.name}</td>
                        <td className="text-sm text-ink-500">
                          {formatDateTime(booking.schedule.start)}
                        </td>
                        <td>
                          <Badge variant={BOOKING_STATUS_VARIANT[booking.status]} size="sm">
                            {booking.statusLabel}
                          </Badge>
                        </td>
                        <td className="text-right font-semibold tabular-nums text-ink-900">
                          {money(booking.pricing.final ?? booking.pricing.quoted)}
                        </td>
                        <td className="text-right">
                          {CANCELLABLE.has(booking.status) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={Ban}
                              className="whitespace-nowrap text-danger-600 hover:bg-danger-50"
                              onClick={() => setCancelling(booking)}
                            >
                              Cancel
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="divide-y divide-ink-200 lg:hidden">
                {bookings.map((booking) => (
                  <li key={booking.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-ink-900">{booking.category.name}</p>
                        <p className="mt-0.5 font-mono text-xs text-ink-400">{booking.reference}</p>
                      </div>
                      <Badge variant={BOOKING_STATUS_VARIANT[booking.status]} size="sm">
                        {booking.statusLabel}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-ink-500">
                      {booking.customer.name} → {booking.provider.name}
                    </p>
                    <div className="mt-1.5 flex items-baseline justify-between">
                      <span className="text-sm text-ink-500">
                        {formatDateTime(booking.schedule.start)}
                      </span>
                      <span className="font-medium text-ink-900">
                        {money(booking.pricing.final ?? booking.pricing.quoted)}
                      </span>
                    </div>

                    {CANCELLABLE.has(booking.status) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={Ban}
                        className="mt-2 text-danger-600 hover:bg-danger-50"
                        onClick={() => setCancelling(booking)}
                      >
                        Cancel booking
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardBody>
      </Card>

      <Pagination
        className="mt-5"
        page={meta.page || 1}
        totalPages={meta.totalPages}
        total={meta.total}
        onChange={setPage}
      />

      <Modal
        open={Boolean(cancelling)}
        onClose={() => {
          setCancelling(null);
          setReason('');
        }}
        title="Cancel this booking?"
      >
        {cancelling && (
          <div className="space-y-4">
            <p className="text-base text-ink-600">
              <span className="font-mono text-sm">{cancelling.reference}</span>
              {' — '}
              <span className="font-medium text-ink-900">{cancelling.category.name}</span>
              {' for '}
              {cancelling.customer.name}, with {cancelling.provider.name}.
            </p>

            {cancelling.status === 'in_progress' && (
              <Alert variant="warning">
                This job is already under way. The provider is likely at the address right now, so
                tell both sides why.
              </Alert>
            )}

            <Textarea
              label="Reason"
              rows={2}
              maxLength={300}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              hint="At least 5 characters. Sent to the customer and the provider, and recorded in the audit log."
            />

            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => {
                  setCancelling(null);
                  setReason('');
                }}
              >
                Keep it
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                loading={cancelBooking.isPending}
                disabled={reason.trim().length < MIN_REASON}
                onClick={() => cancelBooking.mutate({ id: cancelling.id, why: reason.trim() })}
              >
                Cancel booking
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
