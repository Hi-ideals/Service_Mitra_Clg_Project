import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ScrollText, Download, Search, ChevronDown, ChevronRight, AlertTriangle,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { keys } from '../../lib/queryClient.js';
import { useToast } from '../../context/ToastContext.jsx';
import Card, { CardBody } from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { PageLoader } from '../../components/ui/Spinner.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { formatDateTime, timeAgo, pluralise } from '../../lib/format.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';

const PAGE_SIZE = 25;

/**
 * What the people with the most power on this platform actually did.
 *
 * Admin endpoints skip the ownership checks that protect every other screen -
 * that is what being an admin means - and this trail is what stands in their
 * place. It is read-only by design: there is no edit, no delete, and no
 * endpoint behind one. A log that can be changed by the people it describes
 * is not evidence of anything.
 */
function Value({ value }) {
  if (value === null || value === undefined) {
    return <span className="text-ink-400">nothing</span>;
  }
  if (typeof value === 'boolean') return <span>{value ? 'yes' : 'no'}</span>;
  if (typeof value === 'object') {
    return <span className="font-mono text-xs">{JSON.stringify(value)}</span>;
  }

  const text = String(value);
  if (!text) return <span className="text-ink-400">empty</span>;
  // Long values are truncated rather than allowed to push the row sideways.
  return <span>{text.length > 80 ? text.slice(0, 80) + '…' : text}</span>;
}

function Entry({ row }) {
  const [open, setOpen] = useState(false);
  const hasDetail = row.changes.length > 0 || row.entity.id || row.requestId;

  return (
    <li className="px-4 py-3.5 sm:px-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {hasDetail ? (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label={open ? 'Hide details' : 'Show details'}
              className="mt-0.5 shrink-0 rounded text-ink-400 hover:text-ink-700"
            >
              {open
                ? <ChevronDown aria-hidden="true" className="h-4 w-4" />
                : <ChevronRight aria-hidden="true" className="h-4 w-4" />}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}

          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 font-medium text-ink-900">
              {row.label}
              {/* Not a severity - everything here was done by someone
                  authorised. It marks what is worth noticing in a long list:
                  a copy of the data leaving, money moving, access removed. */}
              {row.notable && <Badge variant="warning">notable</Badge>}
            </p>

            <p className="mt-0.5 text-sm text-ink-500">
              {row.admin ? (
                <>
                  <span className="text-ink-700">{row.admin.name}</span>
                  {row.entity.name && <> · {row.entity.name}</>}
                </>
              ) : (
                // The account was deleted; the entry is not.
                <span className="italic">account since removed</span>
              )}
              {!row.entity.name && row.entity.type && <> · {row.entity.type.replace(/_/g, ' ')}</>}
            </p>

            {row.reason && <p className="mt-1 text-sm text-ink-600">{row.reason}</p>}
          </div>
        </div>

        <p className="shrink-0 text-sm text-ink-500 sm:text-right">
          <span className="block">{timeAgo(row.at)}</span>
          <span className="block text-xs text-ink-400">{formatDateTime(row.at)}</span>
        </p>
      </div>

      {open && (
        <div className="ml-7 mt-3 space-y-2 rounded-card bg-ink-50 p-3 text-sm">
          {row.changes.length > 0 && (
            <dl className="space-y-1.5">
              {row.changes.map((change) => (
                <div key={change.field} className="flex flex-wrap items-baseline gap-x-2">
                  <dt className="font-medium text-ink-700">{change.field.replace(/_/g, ' ')}</dt>
                  <dd className="flex flex-wrap items-baseline gap-2 text-ink-600">
                    <span className="line-through decoration-ink-400"><Value value={change.from} /></span>
                    <span aria-hidden="true">→</span>
                    <span className="font-medium text-ink-900"><Value value={change.to} /></span>
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {/* The address has moved up to the row itself, so what is left
              here is the identifiers you only want when tracing one entry. */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-ink-500">
            {row.entity.id && (
              <span>
                <span className="text-ink-400">Record </span>
                <span className="font-mono">{row.entity.id}</span>
              </span>
            )}
            {row.requestId && (
              <span>
                <span className="text-ink-400">Request </span>
                <span className="font-mono">{row.requestId}</span>
              </span>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

export default function AuditLog() {
  useDocumentTitle('Audit log');
  const toast = useToast();

  const [action, setAction] = useState('');
  const [adminId, setAdminId] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const filters = { action, adminId, search, from, to, page, limit: PAGE_SIZE };

  const { data: options } = useQuery({
    queryKey: keys.admin.auditFilters,
    queryFn: async () => (await api.get('/admin/audit/filters')).data,
  });

  const { data, isLoading } = useQuery({
    queryKey: keys.admin.audit(filters),
    queryFn: async () => await api.get('/admin/audit', { params: filters }),
    placeholderData: (previous) => previous,
  });

  async function exportCsv() {
    setExporting(true);
    try {
      await api.download('/admin/audit', {
        params: { ...filters, format: 'csv', page: undefined, limit: 5000 },
        filename: 'servicemitra-audit-log.csv',
      });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setExporting(false);
    }
  }

  // Changing a filter while on page 4 would ask for page 4 of a shorter list
  // and show an empty screen.
  const setFilter = (apply) => (value) => {
    apply(value);
    setPage(1);
  };

  const rows = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const coverage = options?.coverage;

  return (
    <>
      <PageHeader
        icon={ScrollText}
        title="Audit log"
        description="Every consequential action taken from the admin console."
        action={
          <Button
            variant="secondary"
            icon={Download}
            loading={exporting}
            disabled={total === 0}
            onClick={exportCsv}
          >
            Export CSV
          </Button>
        }
      />

      <Card className="mt-4">
        <CardBody className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              label="Search"
              icon={Search}
              placeholder="Reason, admin or action"
              value={search}
              onChange={(e) => setFilter(setSearch)(e.target.value)}
            />

            <Select
              label="Action"
              value={action}
              onChange={(e) => setFilter(setAction)(e.target.value)}
            >
              <option value="">Everything</option>
              {(options?.actions ?? []).map((a) => (
                <option key={a.action} value={a.action}>
                  {a.action.replace(/[._]/g, ' ')} ({a.n})
                </option>
              ))}
            </Select>

            <Select
              label="Admin"
              value={adminId}
              onChange={(e) => setFilter(setAdminId)(e.target.value)}
            >
              <option value="">Anyone</option>
              {(options?.admins ?? []).map((a) => (
                <option key={a.id} value={a.id}>{a.full_name}</option>
              ))}
            </Select>

            <div className="grid grid-cols-2 gap-2">
              <Input
                label="From"
                type="date"
                value={from}
                onChange={(e) => setFilter(setFrom)(e.target.value)}
              />
              <Input
                label="To"
                type="date"
                value={to}
                onChange={(e) => setFilter(setTo)(e.target.value)}
              />
            </div>
          </div>

          <p className="text-sm text-ink-500">
            {pluralise(total, 'entry', 'entries')}
            {coverage?.oldest && <> · recorded since {formatDateTime(coverage.oldest)}</>}
          </p>
        </CardBody>
      </Card>

      <Card className="mt-3">
        <CardBody className="p-0">
          {isLoading ? (
            <PageLoader label="Reading the log" />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="Nothing matches"
              description="No admin action matches these filters. Try widening the dates."
            />
          ) : (
            <ul className="divide-y divide-ink-200/80">
              {rows.map((row) => <Entry key={row.id} row={row} />)}
            </ul>
          )}
        </CardBody>
      </Card>

      {totalPages > 1 && (
        <Pagination className="mt-4" page={page} totalPages={totalPages} onChange={setPage} />
      )}

      <p className="mt-4 flex items-start gap-2 text-sm text-ink-500">
        <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          This log cannot be edited or deleted, from here or anywhere else in the application. That
          is deliberate: a record the people it describes can change is not a record.
        </span>
      </p>
    </>
  );
}
