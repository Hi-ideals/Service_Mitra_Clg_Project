import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  UserPlus, Users, ShieldCheck, ShieldAlert, Pause, Play, Star, Briefcase,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import Card, { CardBody, CardHeader } from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Input from '../../components/ui/Input.jsx';
import Alert from '../../components/ui/Alert.jsx';
import Avatar from '../../components/ui/Avatar.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { PageLoader } from '../../components/ui/Spinner.jsx';
import { formatDate } from '../../lib/format.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import PageHeader from '../../components/ui/PageHeader.jsx';

const EMPTY = { fullName: '', email: '', phone: '', password: '', headline: '' };

const PASSWORD_RULES = [
  { label: '8+ characters', test: (v) => (v || '').length >= 8 },
  { label: 'a lowercase letter', test: (v) => /[a-z]/.test(v || '') },
  { label: 'an uppercase letter', test: (v) => /[A-Z]/.test(v || '') },
  { label: 'a number', test: (v) => /[0-9]/.test(v || '') },
];

export default function Team() {
  useDocumentTitle('My team');
  const toast = useToast();
  const queryClient = useQueryClient();

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [confirmSuspend, setConfirmSuspend] = useState(null);

  const { data: overview } = useQuery({
    queryKey: ['agency', 'overview'],
    queryFn: async () => (await api.get('/agencies/me/overview')).data,
  });

  const { data: team, isLoading } = useQuery({
    queryKey: ['agency', 'team'],
    queryFn: async () => (await api.get('/agencies/me/providers')).data,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['agency'] });

  const add = useMutation({
    mutationFn: () =>
      api.post('/agencies/me/providers', {
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        password: form.password,
        ...(form.headline.trim() ? { headline: form.headline.trim() } : {}),
      }),
    onSuccess: ({ message }) => {
      setAddOpen(false);
      setForm(EMPTY);
      refresh();
      toast.success(message);
    },
    onError: (e) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status, reason }) =>
      api.patch('/agencies/me/providers/' + id + '/status', { status, ...(reason ? { reason } : {}) }),
    onSuccess: ({ message }) => {
      setConfirmSuspend(null);
      refresh();
      toast.success(message);
    },
    onError: (e) => toast.error(e.message),
  });

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const fieldError = (name) => add.error?.fieldErrors?.[name];

  const passwordOk = PASSWORD_RULES.every((r) => r.test(form.password));
  const canSubmit =
    form.fullName.trim().length >= 2 &&
    /\S+@\S+\.\S+/.test(form.email) &&
    /^[6-9][0-9]{9}$/.test(form.phone.trim()) &&
    passwordOk;

  if (isLoading) return <PageLoader label="Loading your team" />;

  const members = team ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        icon={Users}
        title="My team"
        description="The people who work under your agency. Each one signs in with their own account."
        action={
          <Button icon={UserPlus} onClick={() => setAddOpen(true)}>
            Add a person
          </Button>
        }
      />

      {overview && !overview.canOperate && (
        <Alert variant="warning" className="mt-4">
          Your agency is not verified yet, so nobody on your team appears in search. You can keep
          adding people in the meantime.
        </Alert>
      )}

      {/* Said once, here, rather than on every row: approval is not inherited
          from the agency any more, and an agency that adds five people and
          waits for them to appear in search needs to know why they have not. */}
      <Alert variant="info" className="mt-4">
        Everyone on your team is verified individually. Each person signs in, uploads their Aadhaar
        and a photograph, and can take bookings once an admin has approved them.
      </Alert>

      <Card className="mt-4">
        <CardHeader
          title={members.length + (members.length === 1 ? ' person' : ' people')}
          subtitle="Everyone here is paid directly for the work they do."
        />
        <CardBody className={members.length ? 'p-0' : undefined}>
          {members.length === 0 ? (
            <EmptyState
              compact
              icon={Users}
              title="Nobody on your team yet"
              description="Add your first electrician, plumber or carpenter and they can start taking jobs."
              action={
                <Button icon={UserPlus} onClick={() => setAddOpen(true)}>
                  Add a person
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-ink-200">
              {members.map((m) => {
                const suspended = m.accountStatus === 'suspended';
                return (
                  <li key={m.id} className="row-hover flex flex-wrap items-start gap-3 px-4 py-3.5 sm:px-5">
                    <Avatar name={m.name} size="md" />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-ink-900">{m.name}</p>
                        {suspended ? (
                          <Badge variant="danger" size="sm">suspended</Badge>
                        ) : m.verificationStatus === 'approved' ? (
                          <Badge variant="success" size="sm">
                            <ShieldCheck aria-hidden="true" className="h-3 w-3" />
                            live
                          </Badge>
                        ) : (
                          <Badge variant="warning" size="sm">
                            <ShieldAlert aria-hidden="true" className="h-3 w-3" />
                            waiting on verification
                          </Badge>
                        )}
                      </div>

                      {m.headline && <p className="mt-0.5 text-sm text-ink-500">{m.headline}</p>}

                      <p className="mt-0.5 break-all text-sm text-ink-500">
                        {m.email} · {m.phone}
                      </p>

                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-400">
                        {m.ratingCount > 0 && (
                          <span className="flex items-center gap-1">
                            <Star aria-hidden="true" className="h-3 w-3 fill-warning-500 text-warning-500" />
                            {m.rating.toFixed(1)} ({m.ratingCount})
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Briefcase aria-hidden="true" className="h-3 w-3" />
                          {m.jobsCompleted} done
                          {m.openJobs > 0 && ' · ' + m.openJobs + ' open'}
                        </span>
                        <span>
                          {m.lastLoginAt ? 'Last in ' + formatDate(m.lastLoginAt) : 'Never signed in'}
                        </span>
                      </div>
                    </div>

                    <Button
                      size="sm"
                      variant={suspended ? 'secondary' : 'ghost'}
                      icon={suspended ? Play : Pause}
                      loading={setStatus.isPending && setStatus.variables?.id === m.id}
                      onClick={() =>
                        suspended
                          ? setStatus.mutate({ id: m.id, status: 'active' })
                          : setConfirmSuspend(m)
                      }
                    >
                      {suspended ? 'Restore' : 'Suspend'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* ---------- add someone ---------- */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add someone to your team"
        description="They sign in with these details and run their own jobs."
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              loading={add.isPending}
              disabled={!canSubmit}
              onClick={() => add.mutate()}
            >
              Add them
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input
            label="Their full name"
            value={form.fullName}
            onChange={set('fullName')}
            error={fieldError('fullName')}
            placeholder="Ravi Kumar"
            required
          />
          <Input
            label="Their email address"
            type="email"
            value={form.email}
            onChange={set('email')}
            error={fieldError('email')}
            placeholder="ravi@example.com"
            autoComplete="off"
            required
            hint="They sign in with this, and it is where their job alerts go."
          />
          <Input
            label="Their phone number"
            value={form.phone}
            onChange={set('phone')}
            error={fieldError('phone')}
            placeholder="9876543210"
            inputMode="numeric"
            required
            hint="Customers call this number when the job is confirmed."
          />
          <Input
            label="A password for them"
            type="text"
            value={form.password}
            onChange={set('password')}
            error={fieldError('password')}
            autoComplete="off"
            required
          />

          <ul className="-mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {PASSWORD_RULES.map((rule) => {
              const met = rule.test(form.password);
              return (
                <li
                  key={rule.label}
                  className={'text-xs ' + (met ? 'text-success-700' : 'text-ink-400')}
                >
                  {met ? '✓' : '·'} {rule.label}
                </li>
              );
            })}
          </ul>

          <Input
            label="What they do"
            value={form.headline}
            onChange={set('headline')}
            placeholder="Wiring, fittings and repairs"
            hint="Optional. Shown on their profile."
          />

          <Alert variant="info">
            Tell them this password yourself, then ask them to change it once they sign in. They set
            their own prices, hours and bank details, and they are paid directly for their work.
          </Alert>
        </div>
      </Modal>

      {/* ---------- suspend ---------- */}
      <Modal
        open={Boolean(confirmSuspend)}
        onClose={() => setConfirmSuspend(null)}
        title={'Suspend ' + (confirmSuspend?.name ?? '') + '?'}
        description="They stop appearing in search and cannot sign in."
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setConfirmSuspend(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              loading={setStatus.isPending}
              onClick={() => setStatus.mutate({ id: confirmSuspend.id, status: 'suspended' })}
            >
              Suspend
            </Button>
          </div>
        }
      >
        <Alert variant="warning">
          {confirmSuspend?.openJobs > 0
            ? confirmSuspend.name + ' has ' + confirmSuspend.openJobs +
              ' job(s) still open. Those bookings stay with them and are not cancelled — sort them out before suspending.'
            : 'Their past jobs, reviews and earnings are kept. You can restore them at any time.'}
        </Alert>
      </Modal>
    </div>
  );
}
