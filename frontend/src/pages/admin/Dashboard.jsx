import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarRange, IndianRupee, Users, ShieldAlert, TrendingUp, TrendingDown, ArrowRight, Clock,
  LayoutDashboard,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { keys } from '../../lib/queryClient.js';
import Card, { CardBody, CardHeader } from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import Select from '../../components/ui/Select.jsx';
import Badge from '../../components/ui/Badge.jsx';
import { PageLoader } from '../../components/ui/Spinner.jsx';
import StatTile from '../../components/ui/StatTile.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { money, formatDate } from '../../lib/format.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';

const RANGES = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

/**
 * A minimal bar chart, drawn with divs.
 *
 * A charting library would be 40 KB for one view; this is enough to see shape
 * and trend, which is what a daily glance is for.
 */
function MiniChart({ points, valueKey = 'bookings' }) {
  if (!points?.length) return null;

  const values = points.map((p) => (valueKey === 'revenue' ? p.revenue.minor : p[valueKey]));
  const max = Math.max(...values, 1);

  return (
    <div className="flex h-32 items-end gap-0.5 rounded-field bg-grid bg-[length:2rem_2rem]" role="img" aria-label="Daily trend">
      {points.map((point, index) => {
        const value = values[index];
        return (
          <div
            key={point.period}
            className="group relative flex-1 rounded-t bg-gradient-to-t from-brand-200 to-brand-400
                       transition-[background-color,filter] duration-200 hover:from-brand-400 hover:to-brand-600"
            style={{ height: Math.max((value / max) * 100, 2) + '%' }}
            title={formatDate(point.period, { short: true }) + ': ' + value}
          />
        );
      })}
    </div>
  );
}

export default function AdminDashboard() {
  useDocumentTitle('Platform dashboard');
  const [days, setDays] = useState('30');
  const from = new Date(Date.now() - Number(days) * 86400000).toISOString();

  const { data, isLoading } = useQuery({
    queryKey: keys.admin.dashboard(days),
    queryFn: async () => (await api.get('/admin/analytics/dashboard', { params: { from } })).data,
  });

  const { data: series } = useQuery({
    queryKey: keys.admin.series(days),
    queryFn: async () =>
      (await api.get('/admin/analytics/series', { params: { from, granularity: 'day' } })).data,
  });

  const { data: categories } = useQuery({
    queryKey: ['admin', 'analytics', 'categories', days],
    queryFn: async () => (await api.get('/admin/analytics/categories', { params: { from, limit: 5 } })).data,
  });

  const { data: providers } = useQuery({
    queryKey: ['admin', 'analytics', 'providers', days],
    queryFn: async () =>
      (await api.get('/admin/analytics/providers', { params: { from, limit: 5, sort: 'revenue' } })).data,
  });

  if (isLoading) return <PageLoader label="Loading the dashboard" />;
  if (!data) return null;

  const needsAttention =
    data.attention.pendingKyc + data.attention.openDisputes + data.attention.flaggedReviews;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        icon={LayoutDashboard}
        title="Platform dashboard"
        description={formatDate(data.range.from) + ' to ' + formatDate(data.range.to)}
        action={
          <Select
            value={days}
            onChange={(e) => setDays(e.target.value)}
            options={RANGES}
            containerClassName="w-44"
            aria-label="Date range"
          />
        }
      />

      {needsAttention > 0 && (
        <Card className="mt-4 bg-gradient-to-br from-warning-50 to-white ring-warning-500/25">
          <CardBody className="flex flex-wrap items-center gap-4">
            <span className="icon-chip icon-chip-warning h-9 w-9">
              <ShieldAlert aria-hidden="true" className="h-[1.125rem] w-[1.125rem]" />
            </span>
            <p className="font-semibold text-ink-900">Needs your attention</p>

            <div className="flex flex-wrap gap-2">
              {data.attention.pendingKyc > 0 && (
                <Button as={Link} to="/admin/verification" size="sm" variant="secondary">
                  {data.attention.pendingKyc} to verify
                </Button>
              )}
              {data.attention.openDisputes > 0 && (
                <Button as={Link} to="/admin/disputes" size="sm" variant="secondary">
                  {data.attention.openDisputes} open disputes
                </Button>
              )}
              {data.attention.flaggedReviews > 0 && (
                <Button as={Link} to="/admin/reviews" size="sm" variant="secondary">
                  {data.attention.flaggedReviews} flagged reviews
                </Button>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      <div className="stagger mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={CalendarRange}
          label="Bookings"
          value={data.bookings.total}
          sub={data.bookings.completionRate + '% completed'}
          tone="brand"
          to="/admin/bookings"
        />
        {/* Money received, not work finished - the provider ledger and the
            payout queue are driven by the same settled payment. */}
        <StatTile
          icon={IndianRupee}
          label="Revenue collected"
          value={money(data.revenue.gross.value)}
          sub={'Commission ' + money(data.revenue.commission.value)}
          tone="success"
        />
        {data.revenue.awaitingPayment?.minor > 0 && (
          <StatTile
            icon={Clock}
            label="Awaiting payment"
            value={money(data.revenue.awaitingPayment.value)}
            sub={data.revenue.awaitingPaymentCount + ' completed, unpaid'}
            tone="warning"
          />
        )}
        <StatTile
          icon={TrendingUp}
          label="Net revenue"
          value={money(data.revenue.net.value)}
          sub={
            data.revenue.refunded.minor > 0
              ? 'After ' + money(data.revenue.refunded.value) + ' refunded'
              : 'No refunds'
          }
          tone={data.revenue.refunded.minor > 0 ? 'warning' : 'success'}
        />
        <StatTile
          icon={Users}
          label="Live providers"
          value={data.marketplace.liveProviders}
          sub={data.marketplace.verifiedProviders + ' verified of ' + data.marketplace.providers}
          tone="info"
          to="/admin/verification"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Bookings per day" subtitle="Hover a bar for the exact figure." />
          <CardBody>
            <MiniChart points={series?.points} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Booking funnel" subtitle="Where demand falls out." />
          <CardBody className="space-y-2.5 text-base">
            {[
              ['Requested', data.funnel.requested],
              ['Accepted', data.funnel.accepted],
              ['Started', data.funnel.started],
              ['Completed', data.funnel.completed],
            ].map(([label, value]) => (
              <div key={label}>
                <div className="flex justify-between">
                  <span className="text-ink-600">{label}</span>
                  <span className="font-medium tabular-nums text-ink-900">{value}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
                  <div
                    className="h-full rounded-full bg-brand-500"
                    style={{
                      width: (data.funnel.requested ? (value / data.funnel.requested) * 100 : 0) + '%',
                    }}
                  />
                </div>
              </div>
            ))}

            <div className="border-t border-ink-200 pt-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-500">Acceptance rate</span>
                <span className="font-medium text-ink-900">{data.funnel.acceptanceRate}%</span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-ink-500">Average response</span>
                <span className="font-medium text-ink-900">{data.funnel.avgResponseMinutes} min</span>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Top categories"
            action={
              <Button as={Link} to="/admin/categories" variant="link" size="sm" iconRight={ArrowRight}>
                Manage
              </Button>
            }
          />
          <CardBody className="p-0">
            <ul className="divide-y divide-ink-200">
              {(categories || []).map((category) => (
                <li key={category.id} className="row-hover flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink-900">{category.name}</p>
                    <p className="text-sm text-ink-500">{category.bookings} bookings</p>
                  </div>
                  <p className="shrink-0 font-medium tabular-nums text-ink-900">
                    {money(category.revenue.value)}
                  </p>
                </li>
              ))}
              {!categories?.length && (
                <li className="px-4 py-6 text-center text-base text-ink-500">
                  No bookings in this period.
                </li>
              )}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Top providers" subtitle="By revenue in this period." />
          <CardBody className="p-0">
            <ul className="divide-y divide-ink-200">
              {(providers || []).map((provider) => (
                <li key={provider.id} className="row-hover flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink-900">{provider.name}</p>
                    <p className="text-sm text-ink-500">
                      {provider.completed} of {provider.bookings} completed
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-medium tabular-nums text-ink-900">
                      {money(provider.revenue.value)}
                    </p>
                    <Badge variant="neutral" size="sm" className="mt-0.5">
                      {provider.rating.count ? provider.rating.average.toFixed(1) : 'New'}
                    </Badge>
                  </div>
                </li>
              ))}
              {!providers?.length && (
                <li className="px-4 py-6 text-center text-base text-ink-500">
                  No activity in this period.
                </li>
              )}
            </ul>
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <StatTile
          icon={Users}
          label="Repeat customers"
          value={data.retention.repeatRate + '%'}
          sub={data.retention.repeatCustomers + ' of ' + data.retention.customers + ' booked again'}
        />
        <StatTile
          icon={IndianRupee}
          label="Average order"
          value={money(data.revenue.averageOrderValue.value)}
        />
        <StatTile
          icon={data.payments.successRate >= 90 ? TrendingUp : TrendingDown}
          label="Payment success"
          value={data.payments.successRate + '%'}
          sub={data.payments.failed + ' failed of ' + data.payments.attempts}
          tone={data.payments.successRate >= 90 ? 'success' : 'warning'}
        />
      </div>
    </div>
  );
}
