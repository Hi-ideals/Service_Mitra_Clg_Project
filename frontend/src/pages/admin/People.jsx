import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Users, Download, Search, ShieldCheck, Building2, UserRound, Ban, RotateCcw,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { keys } from '../../lib/queryClient.js';
import { useToast } from '../../context/ToastContext.jsx';
import Card, { CardBody, CardHeader } from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import StatTile from '../../components/ui/StatTile.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { PageLoader } from '../../components/ui/Spinner.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { formatDate, pluralise } from '../../lib/format.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';

const ROLE_LABEL = {
  customer: 'Customer',
  provider: 'Provider',
  agency: 'Agency',
  admin: 'Admin',
};

const VERIFICATION_VARIANT = {
  approved: 'success',
  pending: 'warning',
  info_requested: 'warning',
  rejected: 'danger',
  suspended: 'danger',
  unsubmitted: 'neutral',
};

const PAGE_SIZE = 20;

/**
 * The people directory.
 *
 * Every other admin screen is about a thing that happened - a booking, a
 * payout, a dispute. This one is about who is on the platform at all, which is
 * the question an admin has to answer before any of the others make sense.
 */
export default function People() {
  useDocumentTitle('People');
  const toast = useToast();
  const queryClient = useQueryClient();

  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [verification, setVerification] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState(null);
  const [reason, setReason] = useState('');
  const [exporting, setExporting] = useState(false);

  const filters = { role, status, verification, search, page, limit: PAGE_SIZE };

  const { data: summary } = useQuery({
    queryKey: keys.admin.peopleSummary,
    queryFn: async () => (await api.get('/admin/people/summary')).data,
  });

  const { data, isLoading } = useQuery({
    queryKey: keys.admin.people(filters),
    queryFn: async () => await api.get('/admin/people', { params: filters }),
    placeholderData: (previous) => previous,
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, next, why }) =>
      api.patch('/admin/people/' + id + '/status', { status: next, reason: why || undefined }),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'people'] });
      setPending(null);
      setReason('');
      toast.success(variables.next === 'suspended' ? 'Account suspended' : 'Account restored');
    },
    onError: (e) => toast.error(e.message),
  });

  async function exportCsv() {
    setExporting(true);
    try {
      await api.download('/admin/people', {
        params: { ...filters, format: 'csv', page: undefined, limit: 5000 },
        filename: 'servicemitra-people.csv',
      });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setExporting(false);
    }
  }

  // Changing a filter while on page 4 would otherwise ask for page 4 of a
  // shorter list and show an empty screen.
  const setFilter = (apply) => (value) => {
    apply(value);
    setPage(1);
  };

  const rows = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        icon={Users}
        title="People"
        description="Everyone on the platform, and whether they have been verified."
        action={
          <Button
            variant="secondary"
            icon={Download}
            loading={exporting}
            onClick={exportCsv}
          >
            Export CSV
          </Button>
        }
      />

      {summary && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            icon={UserRound}
            label="Customers"
            value={summary.customers}
            sub={pluralise(summary.total, 'account') + ' in total'}
          />
          <StatTile
            icon={ShieldCheck}
            label="Verified providers"
            value={summary.providers.verified}
            sub={
              summary.providers.pending > 0
                ? summary.providers.pending + ' waiting on review'
                : 'of ' + summary.providers.total
            }
            tone={summary.providers.pending > 0 ? 'warning' : 'success'}
          />
          <StatTile
            icon={Building2}
            label="Verified agencies"
            value={summary.agencies.verified}
            sub={
              summary.agencies.pending > 0
                ? summary.agencies.pending + ' waiting on review'
                : 'of ' + summary.agencies.total
            }
            tone={summary.agencies.pending > 0 ? 'warning' : 'success'}
          />
          <StatTile
            icon={Ban}
            label="Suspended"
            value={summary.suspended}
            sub="Cannot sign in"
            tone={summary.suspended > 0 ? 'danger' : 'neutral'}
          />
        </div>
      )}

      <Card className="mt-4">
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              label="Search"
              placeholder="Name, email, phone or business"
              icon={Search}
              value={search}
              onChange={(e) => setFilter(setSearch)(e.target.value)}
            />
            <Select
              label="Role"
              value={role}
              onChange={(e) => setFilter(setRole)(e.target.value)}
              options={[
                { value: '', label: 'Everyone' },
                { value: 'customer', label: 'Customers' },
                { value: 'provider', label: 'Providers' },
                { value: 'agency', label: 'Agencies' },
                { value: 'admin', label: 'Admins' },
              ]}
            />
            <Select
              label="Verification"
              value={verification}
              onChange={(e) => setFilter(setVerification)(e.target.value)}
              options={[
                { value: '', label: 'Any' },
                { value: 'approved', label: 'Verified' },
                { value: 'pending', label: 'Waiting on review' },
                { value: 'info_requested', label: 'More information asked' },
                { value: 'rejected', label: 'Rejected' },
                { value: 'unsubmitted', label: 'Nothing submitted' },
              ]}
            />
            <Select
              label="Account"
              value={status}
              onChange={(e) => setFilter(setStatus)(e.target.value)}
              options={[
                { value: '', label: 'Any' },
                { value: 'active', label: 'Active' },
                { value: 'suspended', label: 'Suspended' },
              ]}
            />
          </div>
        </CardBody>
      </Card>

      <Card className="mt-4">
        <CardHeader
          title={pluralise(total, 'person', 'people')}
          subtitle="Suspending an account stops that person signing in."
        />

        <CardBody className="p-0">
          {isLoading ? (
            <PageLoader />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Nobody matches those filters"
              description="Try widening the search or clearing a filter."
            />
          ) : (
            <ul className="divide-y divide-ink-200">
              {rows.map((person) => {
                const suspended = person.status === 'suspended';
                return (
                  <li key={person.id} className="flex flex-wrap items-start gap-3 px-4 py-3.5 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-ink-900">{person.name}</p>
                        <Badge variant="neutral" size="sm">{ROLE_LABEL[person.role] ?? person.role}</Badge>

                        {person.verification && (
                          <Badge
                            variant={VERIFICATION_VARIANT[person.verification] ?? 'neutral'}
                            size="sm"
                          >
                            {person.verification === 'approved' ? 'verified' : person.verification.replace('_', ' ')}
                          </Badge>
                        )}

                        {suspended && <Badge variant="danger" size="sm">suspended</Badge>}
                      </div>

                      {person.businessName && (
                        <p className="mt-0.5 text-sm text-ink-600">{person.businessName}</p>
                      )}

                      <p className="mt-0.5 break-all text-sm text-ink-500">
                        {[person.email, person.phone].filter(Boolean).join(' · ')}
                      </p>

                      <p className="mt-1 text-xs text-ink-400">
                        {person.employer && <>Works for {person.employer} · </>}
                        {person.jobsCompleted !== null && <>{pluralise(person.jobsCompleted, 'job')} done · </>}
                        Joined {formatDate(person.createdAt)}
                      </p>
                    </div>

                    {/* No control on an admin row. The server refuses it too -
                        hiding a button is a courtesy, not a rule - but an
                        action that cannot succeed should not be offered. */}
                    {person.role !== 'admin' && (
                      <Button
                        size="sm"
                        variant={suspended ? 'secondary' : 'danger'}
                        icon={suspended ? RotateCcw : Ban}
                        className="shrink-0 whitespace-nowrap"
                        onClick={() => setPending({ person, next: suspended ? 'active' : 'suspended' })}
                      >
                        {suspended ? 'Restore' : 'Suspend'}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {totalPages > 1 && (
        <Pagination
          className="mt-4"
          page={page}
          totalPages={totalPages}
          total={total}
          onChange={setPage}
        />
      )}

      <Modal
        open={Boolean(pending)}
        onClose={() => {
          setPending(null);
          setReason('');
        }}
        title={pending?.next === 'suspended' ? 'Suspend this account?' : 'Restore this account?'}
      >
        {pending && (
          <div className="space-y-4">
            <p className="text-base text-ink-600">
              {pending.next === 'suspended' ? (
                <>
                  <span className="font-medium text-ink-900">{pending.person.name}</span> will not be
                  able to sign in. A provider is also taken offline, so they stop appearing in
                  search. Their bookings and history stay as they are.
                </>
              ) : (
                <>
                  <span className="font-medium text-ink-900">{pending.person.name}</span> will be
                  able to sign in again. A provider still has to switch themselves back online.
                </>
              )}
            </p>

            {pending.next === 'suspended' && (
              <Textarea
                label="Reason"
                rows={2}
                maxLength={400}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                hint="Recorded in the audit log and sent to them. Optional."
              />
            )}

            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => {
                  setPending(null);
                  setReason('');
                }}
              >
                Cancel
              </Button>
              <Button
                variant={pending.next === 'suspended' ? 'danger' : 'primary'}
                className="flex-1"
                loading={changeStatus.isPending}
                onClick={() =>
                  changeStatus.mutate({ id: pending.person.id, next: pending.next, why: reason })
                }
              >
                {pending.next === 'suspended' ? 'Suspend' : 'Restore'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
