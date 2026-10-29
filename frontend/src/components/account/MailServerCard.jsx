import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Send, ShieldAlert, Server, CheckCircle2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import Card, { CardBody, CardHeader } from '../ui/Card.jsx';
import Alert from '../ui/Alert.jsx';
import Badge from '../ui/Badge.jsx';
import Button from '../ui/Button.jsx';
import Input from '../ui/Input.jsx';
import Select from '../ui/Select.jsx';
import { formatDateTime } from '../../lib/format.js';

/**
 * The mail server, set up from here rather than by editing a file on the box.
 *
 * Two things shape this screen.
 *
 * The password is write-only. It is encrypted before it is stored and is never
 * sent back, so the field shows a placeholder rather than a value, and leaving
 * it empty keeps whatever is already saved - changing a port should not mean
 * finding the credential again.
 *
 * Nothing is saved until it has connected. A mail server that is configured
 * but wrong is worse than none at all: email stops, nothing says so, and the
 * first sign of it is a customer who never got their invoice.
 */
const PORTS = [
  { value: 587, label: '587 - STARTTLS (most common)' },
  { value: 465, label: '465 - SSL/TLS' },
  { value: 25, label: '25 - unencrypted' },
  { value: 2525, label: '2525 - alternative' },
];

const BLANK = {
  enabled: false,
  host: '',
  port: 587,
  secure: false,
  username: '',
  password: '',
  fromName: 'ServiceMitra',
  fromEmail: '',
};

export default function MailServerCard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(BLANK);
  const [touched, setTouched] = useState(false);

  const { data: saved, isLoading } = useQuery({
    queryKey: ['admin', 'smtp'],
    queryFn: async () => (await api.get('/admin/settings/smtp')).data,
  });

  // Fills the form from the server once, and not again afterwards - refetching
  // mid-edit must not overwrite what somebody is halfway through typing.
  useEffect(() => {
    if (!saved || touched) return;
    setForm({ ...BLANK, ...saved, password: '' });
  }, [saved, touched]);

  const set = (field) => (event) => {
    const value = event?.target?.type === 'checkbox' ? event.target.checked : event.target.value;
    setTouched(true);
    setForm((current) => ({ ...current, [field]: value }));
  };

  const save = useMutation({
    mutationFn: () =>
      api.put('/admin/settings/smtp', {
        ...form,
        port: Number(form.port),
        // 465 is TLS from the first byte; everything else starts in the clear
        // and upgrades. Deriving it from the port removes a choice that is
        // only ever got wrong.
        secure: Number(form.port) === 465,
        password: form.password || undefined,
      }),
    onSuccess: (result) => {
      setTouched(false);
      setForm((current) => ({ ...current, password: '' }));
      queryClient.invalidateQueries({ queryKey: ['admin', 'smtp'] });
      toast.success(result?.message ?? 'Mail settings saved');
    },
    onError: (e) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: () => api.post('/admin/settings/smtp/test'),
    onSuccess: (result) => toast.success(result?.message ?? 'Test email sent'),
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return null;

  const live = saved?.enabled;

  return (
    <Card>
      <CardHeader
        icon={Mail}
        title="Email sending"
        subtitle="The mail server that carries verification codes, invoices and booking alerts."
        action={<Badge variant={live ? 'success' : 'neutral'}>{live ? 'On' : 'Off'}</Badge>}
      />

      <CardBody className="space-y-4">
        {!saved?.configured && (
          <Alert variant="warning" title="Not available on this server">
            TOTP_ENCRYPTION_KEY is not set, so the mail password cannot be stored safely. Set it in
            the environment and restart before configuring this.
          </Alert>
        )}

        {/* Where mail actually goes today, which is not always what this form
            shows - somebody may have filled it in and not switched it on. */}
        <div className="flex items-start gap-3 rounded-card bg-ink-50 px-3.5 py-3">
          <span className="icon-chip h-9 w-9 shrink-0 bg-white text-ink-500">
            <Server aria-hidden="true" className="h-[1.125rem] w-[1.125rem]" />
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-medium text-ink-900">
              {live
                ? 'Email is going out through ' + saved.host
                : saved?.fallback?.driver === 'smtp'
                  ? 'Using the server configuration' + (saved.fallback.host ? ' (' + saved.fallback.host + ')' : '')
                  : 'No mail is being sent - codes appear in the server log only'}
            </p>
            {saved?.updatedAt && (
              <p className="mt-0.5 text-ink-500">Last changed {formatDateTime(saved.updatedAt)}</p>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Mail server address"
            placeholder="smtp.gmail.com"
            value={form.host}
            onChange={set('host')}
            containerClassName="sm:col-span-2"
          />

          <Select label="Port" value={form.port} onChange={set('port')}>
            {PORTS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </Select>

          <Input
            label="Username"
            autoComplete="off"
            placeholder="you@gmail.com"
            value={form.username}
            onChange={set('username')}
          />

          <Input
            label="Password"
            type="password"
            revealable
            autoComplete="new-password"
            placeholder={saved?.hasPassword ? 'Saved - leave blank to keep it' : 'App password'}
            hint="Gmail needs an app password, not your account password."
            value={form.password}
            onChange={set('password')}
            containerClassName="sm:col-span-2"
          />

          <Input
            label="Sender name"
            placeholder="ServiceMitra"
            value={form.fromName}
            onChange={set('fromName')}
          />

          <Input
            label="Sender address"
            type="email"
            placeholder="no-reply@yourdomain.com"
            hint="What customers see the email coming from."
            value={form.fromEmail}
            onChange={set('fromEmail')}
          />
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-card p-3 ring-1 ring-inset ring-ink-200/80">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={set('enabled')}
            className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-600/25"
          />
          <span className="min-w-0 text-sm">
            <span className="font-medium text-ink-900">Use this mail server</span>
            <span className="mt-0.5 block text-ink-500">
              {/* Said plainly, because it is the step that proves the settings
                  before they can break anything. */}
              Switching this on tests the connection first. If it cannot connect, nothing is saved.
            </span>
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            loading={save.isPending}
            disabled={!saved?.configured}
            onClick={() => save.mutate()}
          >
            Save settings
          </Button>

          <Button
            variant="secondary"
            icon={Send}
            loading={test.isPending}
            disabled={!live}
            onClick={() => test.mutate()}
          >
            Send test email
          </Button>

          {live && (
            <span className="inline-flex items-center gap-1.5 text-sm text-success-700">
              <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
              Connected
            </span>
          )}
        </div>

        <p className="flex items-start gap-2 text-sm text-ink-500">
          <ShieldAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            The password is encrypted before it is stored and is never shown again, here or
            anywhere else. Whoever can send mail from your domain can send password resets, so
            every change to this is recorded against the account that made it.
          </span>
        </p>
      </CardBody>
    </Card>
  );
}
