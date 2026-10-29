import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Download, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import Card, { CardBody, CardHeader } from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Select from '../../components/ui/Select.jsx';
import Input from '../../components/ui/Input.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { PageLoader } from '../../components/ui/Spinner.jsx';
import { money, formatDate, formatDateTime } from '../../lib/format.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import PageHeader from '../../components/ui/PageHeader.jsx';

const BOOKING_STATUS = [
  'requested', 'accepted', 'in_progress', 'completed',
  'rejected', 'cancelled', 'disputed', 'refunded',
];

const PAYOUT_STATUS = ['pending', 'processing', 'paid', 'failed', 'on_hold'];

const STATUS_VARIANT = {
  completed: 'success',
  paid: 'success',
  in_progress: 'info',
  processing: 'info',
  accepted: 'info',
  requested: 'warning',
  pending: 'warning',
  disputed: 'danger',
  cancelled: 'danger',
  rejected: 'danger',
  failed: 'danger',
  refunded: 'neutral',
  on_hold: 'neutral',
};

/** A labelled figure. Used for every summary number so they line up. */
function Stat({ label, value, hint, tone = 'default' }) {
  return (
    <div className="panel-tint rounded-field p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p
        className={
          'mt-1 text-xl font-semibold tabular-nums ' +
          (tone === 'danger' ? 'text-danger-700' : tone === 'success' ? 'text-success-700' : 'text-ink-900')
        }
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-ink-400">{hint}</p>}
    </div>
  );
}

/** Horizontally scrollable on a phone: a report is a table, and a squashed table is unreadable. */
function ScrollTable({ head, children }) {
  return (
    <div className="no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="data-table w-full min-w-[46rem] text-sm">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h.label} className={h.right ? 'text-right' : undefined}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-200">{children}</tbody>
      </table>
    </div>
  );
}

export default function Reports() {
  useDocumentTitle('Reports');
  const toast = useToast();

  const [tab, setTab] = useState('services');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [filters, setFilters] = useState({ from: '', to: '', status: '', city: '' });

  const isServices = tab === 'services';
  const endpoint = isServices ? '/admin/reports/services' : '/admin/reports/payouts';

  /**
   * A date input gives a plain date; the API wants an instant. `to` is pushed
   * to the end of its day, because a report "to the 22nd" that stops at
   * midnight silently omits everything that happened on the 22nd.
   */
  const queryParams = {
    page,
    limit: 50,
    ...(filters.from ? { from: new Date(filters.from + 'T00:00:00').toISOString() } : {}),
    ...(filters.to ? { to: new Date(filters.to + 'T23:59:59.999').toISOString() } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(isServices && filters.city ? { city: filters.city } : {}),
  };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin', 'reports', tab, queryParams],
    queryFn: async () => (await api.get(endpoint, { params: queryParams })).data,
    placeholderData: (previous) => previous,
  });

  const setFilter = (key) => (e) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    setPage(1);
  };

  const switchTab = (value) => {
    setTab(value);
    setPage(1);
    // Status values differ between the two reports, so carrying one across
    // would filter the new report by a value it has never heard of.
    setFilters((f) => ({ ...f, status: '' }));
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      await api.download(endpoint, {
        params: { ...queryParams, page: 1, limit: 5000, format: 'csv' },
      });
      toast.success('Export downloaded');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setExporting(false);
    }
  };

  if (isLoading) return <PageLoader label="Building the report" />;

  const rows = data?.rows ?? [];
  const totals = data?.totals ?? {};

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        icon={FileText}
        title="Reports"
        description="Every booking and every payout, row by row. Filter it, then export what you filtered."
        action={
          <Button icon={Download} variant="secondary" loading={exporting} onClick={exportCsv}>
            Export CSV
          </Button>
        }
      />

      <Tabs
        className="mt-4"
        value={tab}
        onChange={switchTab}
        tabs={[
          { value: 'services', label: 'Services' },
          { value: 'payouts', label: 'Payouts' },
        ]}
      />

      <Card className="mt-4">
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input type="date" label="From" value={filters.from} onChange={setFilter('from')} />
            <Input type="date" label="To" value={filters.to} onChange={setFilter('to')} />
            <Select label="Status" value={filters.status} onChange={setFilter('status')}>
              <option value="">Any status</option>
              {(isServices ? BOOKING_STATUS : PAYOUT_STATUS).map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ')}
                </option>
              ))}
            </Select>
            {isServices ? (
              <Input label="City" value={filters.city} onChange={setFilter('city')} placeholder="Any city" />
            ) : (
              <div className="hidden lg:block" />
            )}
          </div>
        </CardBody>
      </Card>

      {/* ---------- summary ---------- */}
      <Card className="mt-4">
        <CardHeader
          title={isServices ? 'Summary' : 'Payout summary'}
          subtitle={
            filters.from || filters.to
              ? (filters.from ? formatDate(filters.from) : 'the beginning') +
                ' to ' +
                (filters.to ? formatDate(filters.to) : 'today')
              : 'All time'
          }
        />
        <CardBody>
          {isServices ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Bookings" value={totals.bookings ?? 0} hint={totals.customers + ' customers'} />
              <Stat
                label="Completed"
                value={totals.completed ?? 0}
                hint={(totals.completionRate ?? 0) + '% of all bookings'}
                tone="success"
              />
              <Stat
                label="Collected"
                value={money(totals.collected)}
                hint={'paid for · avg ' + money(totals.averageValue)}
                tone="success"
              />
              <Stat label="Platform commission" value={money(totals.commission)} hint="Your revenue" />
              <Stat label="Owed to providers" value={money(totals.providerEarning)} hint="Collected less commission" />
              <Stat label="Billed" value={money(totals.billed)} hint="All completed work" />
              <Stat
                label="Awaiting payment"
                value={money(totals.awaitingPayment)}
                hint={(totals.unpaidCount ?? 0) + ' completed, unpaid'}
                tone={totals.unpaidCount ? 'danger' : 'default'}
              />
              <Stat label="Cancelled" value={totals.cancelled ?? 0} tone="danger" />
              <Stat label="Declined" value={totals.rejected ?? 0} tone="danger" />
              <Stat label="Providers involved" value={totals.providers ?? 0} />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Payouts" value={totals.payouts ?? 0} hint={totals.providers + ' providers'} />
              <Stat
                label="Paid out"
                value={money(totals.paid)}
                hint={totals.paidCount + ' transfers'}
                tone="success"
              />
              <Stat
                label="Awaiting transfer"
                value={money(totals.awaiting)}
                hint={totals.awaitingCount + ' to send'}
              />
              <Stat
                label="Failed"
                value={money(totals.failed)}
                hint={totals.failedCount + ' returned to balance'}
                tone={totals.failedCount ? 'danger' : 'default'}
              />
            </div>
          )}
        </CardBody>
      </Card>

      {/* ---------- per-service breakdown ---------- */}
      {isServices && data?.byService?.length > 0 && (
        <Card className="mt-4">
          <CardHeader title="By service" subtitle="Where the volume and the money actually are." />
          <CardBody>
            <ScrollTable
              head={[
                { label: 'Service' },
                { label: 'Bookings', right: true },
                { label: 'Completed', right: true },
                { label: 'Lost', right: true },
                { label: 'Collected', right: true },
                { label: 'Commission', right: true },
                { label: 'Unpaid', right: true },
              ]}
            >
              {data.byService.map((s) => (
                <tr key={s.service}>
                  <td className="px-3 py-2 font-medium text-ink-900">{s.service}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.bookings}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-success-700">{s.completed}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-500">{s.lost}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{money(s.collected)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(s.commission)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-warning-700">
                    {s.awaitingPayment ? money(s.awaitingPayment) : '—'}
                  </td>
                </tr>
              ))}
            </ScrollTable>
          </CardBody>
        </Card>
      )}

      {/* ---------- money owed but not yet paid ---------- */}
      {!isServices && data?.outstanding?.length > 0 && (
        <Card className="mt-4">
          <CardHeader
            title="Owed but not yet paid out"
            subtitle="Money on the platform that belongs to providers. It appears in no payout row."
            action={<p className="text-lg font-semibold text-ink-900">{money(data.outstandingTotal)}</p>}
          />
          <CardBody>
            <ScrollTable
              head={[
                { label: 'Provider' },
                { label: 'Owed', right: true },
                { label: 'Payable now', right: true },
                { label: 'Next release' },
                { label: 'Destination' },
              ]}
            >
              {data.outstanding.map((o) => (
                <tr key={o.provider}>
                  <td className="px-3 py-2 font-medium text-ink-900">{o.provider}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{money(o.owed)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(o.payableNow)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-ink-500">
                    {o.nextRelease ? formatDate(o.nextRelease) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {o.hasDestination ? (
                      <span className="text-success-700">On file</span>
                    ) : (
                      <span className="flex items-center gap-1 text-warning-700">
                        <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
                        Missing
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </ScrollTable>
          </CardBody>
        </Card>
      )}

      {/* ---------- the rows ---------- */}
      <Card className="mt-4">
        <CardHeader
          title={isServices ? 'Bookings' : 'Payouts'}
          subtitle={(data?.total ?? 0) + ' matching ' + (isServices ? 'bookings' : 'payouts')}
        />
        <CardBody className={rows.length ? undefined : 'p-0'}>
          {rows.length === 0 ? (
            <EmptyState
              compact
              icon={FileText}
              title="Nothing matches those filters"
              description="Widen the date range, or clear the status filter."
            />
          ) : (
            <div className={isFetching ? 'opacity-60 transition-opacity' : undefined}>
              {isServices ? (
                <ScrollTable
                  head={[
                    { label: 'Booking' },
                    { label: 'Service' },
                    { label: 'Provider' },
                    { label: 'Customer' },
                    { label: 'City' },
                    { label: 'Booked' },
                    { label: 'Status' },
                    { label: 'Payment' },
                    { label: 'Final', right: true },
                    { label: 'Commission', right: true },
                  ]}
                >
                  {rows.map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-ink-500">
                        {r.reference}
                      </td>
                      <td className="px-3 py-2 font-medium text-ink-900">{r.service}</td>
                      <td className="px-3 py-2 text-ink-700">{r.provider}</td>
                      <td className="px-3 py-2 text-ink-700">{r.customer}</td>
                      <td className="px-3 py-2 text-ink-500">{r.city}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-ink-500">{formatDate(r.bookedAt)}</td>
                      <td className="px-3 py-2">
                        <Badge variant={STATUS_VARIANT[r.status]} size="sm">
                          {r.status.replace('_', ' ')}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        {r.status !== 'completed' ? (
                          <span className="text-ink-400">—</span>
                        ) : r.paymentStatus === 'paid' ? (
                          <span className="text-success-700">paid</span>
                        ) : (
                          <span className="text-warning-700">{r.paymentStatus || 'unpaid'}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {r.status === 'completed' ? money(r.final) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-500">
                        {r.status === 'completed' ? money(r.commission) : '—'}
                      </td>
                    </tr>
                  ))}
                </ScrollTable>
              ) : (
                <ScrollTable
                  head={[
                    { label: 'Payout' },
                    { label: 'Provider' },
                    { label: 'Sent to' },
                    { label: 'Bank reference' },
                    { label: 'Prepared' },
                    { label: 'Status' },
                    { label: 'Amount', right: true },
                  ]}
                >
                  {rows.map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-ink-500">
                        {r.reference}
                      </td>
                      <td className="px-3 py-2 font-medium text-ink-900">
                        {r.provider}
                        {r.jobs > 0 && (
                          <span className="ml-1 text-xs font-normal text-ink-400">
                            · {r.jobs} {r.jobs === 1 ? 'job' : 'jobs'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-ink-600">{r.destination || '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs text-ink-600">
                        {r.paymentReference || '—'}
                        {r.recordedBy && (
                          <span className="block font-sans text-xs text-ink-400">by {r.recordedBy}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-ink-500">
                        {formatDateTime(r.preparedAt)}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={STATUS_VARIANT[r.status]} size="sm">
                          {r.status === 'pending' ? 'awaiting' : r.status}
                        </Badge>
                        {r.failureReason && (
                          <span className="mt-1 block max-w-[14rem] text-xs text-danger-700">
                            {r.failureReason}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{money(r.amount)}</td>
                    </tr>
                  ))}
                </ScrollTable>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      {data?.total > 50 && (
        <Pagination
          className="mt-4"
          page={page}
          total={data.total}
          totalPages={Math.ceil(data.total / 50)}
          onChange={setPage}
        />
      )}
    </div>
  );
}
