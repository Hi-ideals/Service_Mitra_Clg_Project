import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Inbox, CalendarCheck, Wallet, Star, Power, ArrowRight, CheckCircle2, Circle,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { keys } from '../../lib/queryClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import BookingCard from '../../components/BookingCard.jsx';
import Card, { CardBody, CardHeader } from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import StatTile from '../../components/ui/StatTile.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { PageLoader } from '../../components/ui/Spinner.jsx';
import { money, pluralise } from '../../lib/format.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';

/** The go-live checklist from the API, rendered as something actionable. */
function Readiness({ readiness }) {
  if (!readiness || readiness.complete) return null;

  return (
    <Card>
      <CardHeader
        title="Finish setting up"
        subtitle={readiness.percentComplete + '% done - complete these to start taking bookings.'}
      />
      <CardBody>
        <div className="mb-4 h-2 overflow-hidden rounded-full bg-ink-100 shadow-inset-top">
          <div
            className="h-full rounded-full bg-brand-gradient transition-[width] duration-500 ease-out"
            style={{ width: readiness.percentComplete + '%' }}
          />
        </div>

        <ul className="space-y-2.5">
          {readiness.steps.map((step) => (
            <li key={step.key} className="flex items-center gap-2.5">
              {step.done ? (
                <CheckCircle2 aria-hidden="true" className="h-5 w-5 shrink-0 text-success-600" />
              ) : (
                <Circle aria-hidden="true" className="h-5 w-5 shrink-0 text-ink-300" />
              )}
              <span className={clsx('text-base', step.done ? 'text-ink-400 line-through' : 'text-ink-700')}>
                {step.label}
              </span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

export default function Dashboard() {
  useDocumentTitle('Provider dashboard');
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data: profile, isLoading } = useQuery({
    queryKey: keys.providers.me,
    queryFn: async () => (await api.get('/providers/me')).data,
  });

  const { data: counts } = useQuery({
    queryKey: keys.bookings.counts,
    queryFn: async () => (await api.get('/bookings/counts')).data,
  });

  const { data: earnings } = useQuery({
    queryKey: keys.earnings({ limit: 1 }),
    queryFn: async () => (await api.get('/earnings', { params: { limit: 1 } })).data,
  });

  const { data: incoming } = useQuery({
    queryKey: keys.bookings.list({ status: 'requested' }),
    queryFn: () => api.get('/bookings', { params: { status: 'requested', limit: 3 } }),
  });

  const toggleOnline = useMutation({
    mutationFn: (isAcceptingBookings) => api.patch('/providers/me/status', { isAcceptingBookings }),
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({ queryKey: keys.providers.me });
      toast.success(data.isDiscoverable ? 'You are online and visible to customers' : 'You are now offline');
    },
    onError: (error) => {
      // The API refuses with a checklist when the profile is incomplete, and
      // that detail is more useful than the headline message.
      const pending = error.details?.pending;
      toast.error(pending?.length ? 'Still to do: ' + pending.join(', ') : error.message);
    },
  });

  if (isLoading) return <PageLoader label="Loading your dashboard" />;
  if (!profile) return null;

  const requests = incoming?.data ?? [];

  return (
    <div className="page max-w-5xl py-5 sm:py-7">
      <PageHeader
        title={'Hello, ' + (user?.fullName?.split(' ')[0] ?? '')}
        description={
          profile.isDiscoverable
            ? 'You are online and customers can book you.'
            : 'You are offline. Customers cannot see you in search.'
        }
        action={
          <Button
            variant={profile.isAcceptingBookings ? 'secondary' : 'primary'}
            icon={Power}
            loading={toggleOnline.isPending}
            onClick={() => toggleOnline.mutate(!profile.isAcceptingBookings)}
          >
            {profile.isAcceptingBookings ? 'Go offline' : 'Go online'}
          </Button>
        }
      >
        {/* The halo pulses only while genuinely online, so the indicator
            reports state rather than merely decorating the page. */}
        <Badge
          variant={profile.isDiscoverable ? 'success' : 'neutral'}
          size="sm"
          dot
          pulse={profile.isDiscoverable}
          className="mt-2"
        >
          {profile.isDiscoverable ? 'Online' : 'Offline'}
        </Badge>
      </PageHeader>

      <div className="stagger mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={Inbox}
          tone={counts?.requested > 0 ? 'warning' : 'neutral'}
          label="New requests"
          value={counts?.requested ?? 0}
          sub="Awaiting your response"
          to="/provider/requests"
        />
        <StatTile
          icon={CalendarCheck}
          tone="info"
          label="Jobs booked"
          value={(counts?.accepted ?? 0) + (counts?.inProgress ?? 0)}
          sub="Accepted and in progress"
          to="/provider/requests"
        />
        <StatTile
          icon={Wallet}
          tone="success"
          label="Available to withdraw"
          value={money(earnings?.balance.available ?? 0)}
          sub={
            earnings?.balance.pendingMinor > 0
              ? money(earnings.balance.pending) + ' still held'
              : 'Released after the dispute window'
          }
          to="/provider/earnings"
        />
        <StatTile
          icon={Star}
          tone="brand"
          label="Your rating"
          value={profile.reputation.ratingCount ? profile.reputation.ratingAverage.toFixed(1) : 'New'}
          sub={
            profile.reputation.ratingCount
              ? pluralise(profile.reputation.ratingCount, 'review')
              : 'No reviews yet'
          }
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader
              title="Incoming requests"
              action={
                requests.length > 0 && (
                  <Button
                    as={Link}
                    to="/provider/requests"
                    variant="link"
                    size="sm"
                    iconRight={ArrowRight}
                    className="shrink-0 whitespace-nowrap"
                  >
                    See all
                  </Button>
                )
              }
            />
            <CardBody className="space-y-3">
              {requests.length === 0 ? (
                <EmptyState
                  compact
                  icon={Inbox}
                  title="No new requests"
                  description={
                    profile.isDiscoverable
                      ? 'You will be notified the moment a customer books you.'
                      : 'Go online so customers can find and book you.'
                  }
                />
              ) : (
                requests.map((booking) => (
                  <BookingCard
                    key={booking.id}
                    booking={booking}
                    perspective="provider"
                    to={'/provider/jobs/' + booking.id}
                  />
                ))
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Readiness readiness={profile.readiness} />

          <Card>
            <CardHeader title="How you are doing" />
            <CardBody className="space-y-2.5 text-base">
              <div className="flex justify-between">
                <span className="text-ink-500">Jobs completed</span>
                <span className="font-medium text-ink-900">{profile.reputation.jobsCompleted}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-500">Acceptance rate</span>
                <span className="font-medium text-ink-900">{profile.reputation.acceptanceRate}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-500">Verification</span>
                <Badge
                  variant={profile.verificationStatus === 'approved' ? 'success' : 'warning'}
                  size="sm"
                >
                  {profile.verificationStatus === 'approved' ? 'Verified' : profile.verificationStatus}
                </Badge>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
