import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Users, CalendarRange, CheckCircle2, Star, ArrowRight, ShieldAlert, UserPlus, Building2,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import Card, { CardBody, CardHeader } from '../../components/ui/Card.jsx';
import Badge, { BOOKING_STATUS_VARIANT } from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Alert from '../../components/ui/Alert.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import StatTile from '../../components/ui/StatTile.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { PageLoader } from '../../components/ui/Spinner.jsx';
import { money, formatDateTime } from '../../lib/format.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';

export default function AgencyDashboard() {
  useDocumentTitle('Agency dashboard');

  const { data, isLoading } = useQuery({
    queryKey: ['agency', 'overview'],
    queryFn: async () => (await api.get('/agencies/me/overview')).data,
  });

  const { data: recent } = useQuery({
    queryKey: ['agency', 'jobs', 'recent'],
    queryFn: () => api.get('/agencies/me/bookings', { params: { limit: 6 } }),
  });

  if (isLoading) return <PageLoader label="Loading your agency" />;
  if (!data) return null;

  const jobs = recent?.data ?? [];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        icon={Building2}
        eyebrow="Agency"
        title={data.agency.name}
        description="Your team and the work they are doing."
        action={
          <Button as={Link} to="/agency/team" icon={UserPlus} variant="secondary">
            Add a person
          </Button>
        }
      />

      {!data.canOperate && (
        <Alert variant="warning" className="mt-4">
          <span className="flex items-start gap-2">
            <ShieldAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>Your agency is not verified yet.</strong> Nobody on your team appears in
              search until it is. Submit your documents to get started.
              <span className="mt-2 block">
                <Button as={Link} to="/agency/verification" size="sm">
                  Start verification
                </Button>
              </span>
            </span>
          </span>
        </Alert>
      )}

      <div className="stagger mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={Users}
          label="Team"
          value={data.providers}
          sub={data.approvedProviders + ' live · ' + data.onlineProviders + ' online now'}
          tone="brand"
          to="/agency/team"
        />
        <StatTile
          icon={CalendarRange}
          label="Open jobs"
          value={data.openJobs}
          sub="In progress or awaiting a response"
          tone={data.openJobs > 0 ? 'warning' : 'neutral'}
          to="/agency/jobs"
        />
        <StatTile
          icon={CheckCircle2}
          label="Completed"
          value={data.completedJobs}
          sub={'of ' + data.totalJobs + ' total'}
          tone="success"
        />
        <StatTile
          icon={Star}
          label="Average rating"
          value={data.averageRating ? data.averageRating.toFixed(1) : '—'}
          sub="Across everyone rated"
          tone="brand"
        />
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Recent work"
          subtitle="Every job your team has taken."
          action={
            <Button as={Link} to="/agency/jobs" variant="ghost" size="sm" iconRight={ArrowRight}>
              All jobs
            </Button>
          }
        />
        <CardBody className={jobs.length ? 'p-0' : undefined}>
          {jobs.length === 0 ? (
            <EmptyState
              compact
              icon={CalendarRange}
              title="No jobs yet"
              description={
                data.canOperate
                  ? 'Once customers book your team, their jobs appear here.'
                  : 'Jobs start arriving once your agency is verified.'
              }
            />
          ) : (
            <ul className="divide-y divide-ink-200">
              {jobs.map((j) => (
                <li key={j.id} className="row-hover flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <p className="font-medium text-ink-900">{j.service}</p>
                    <p className="mt-0.5 text-sm text-ink-500">
                      {j.providerName} · {j.customerName}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-400">
                      {formatDateTime(j.scheduledStart)} · {j.reference}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="figure text-base">
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

      <p className="mt-4 px-1 text-xs text-ink-400">
        Each person on your team is paid directly for the work they do. ServiceMitra never routes
        their earnings through the agency.
      </p>
    </div>
  );
}
