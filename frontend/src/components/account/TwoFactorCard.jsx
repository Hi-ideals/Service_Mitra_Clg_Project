import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { ShieldCheck, ShieldAlert, Smartphone, KeyRound, Copy, Check, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import Card, { CardBody, CardHeader } from '../ui/Card.jsx';
import Alert from '../ui/Alert.jsx';
import Badge from '../ui/Badge.jsx';
import Button from '../ui/Button.jsx';
import Input from '../ui/Input.jsx';
import Modal from '../ui/Modal.jsx';
import RecoveryCodes from './RecoveryCodes.jsx';

/**
 * Two-factor authentication, from the account's side.
 *
 * Three states, and the screen only ever shows one of them: off, half-set-up
 * (a QR code waiting for its first code), and on.
 */
export default function TwoFactorCard() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [setup, setSetup] = useState(null);      // { secret, otpauthUri }
  const [qr, setQr] = useState(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [disabling, setDisabling] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

  const { data: status, isLoading } = useQuery({
    queryKey: ['auth', '2fa'],
    queryFn: async () => (await api.get('/auth/2fa')).data,
  });

  // Rendered in the browser, never fetched. Sending the secret to a QR service
  // on the internet would hand the second factor to a third party.
  useEffect(() => {
    if (!setup?.otpauthUri) { setQr(null); return; }

    let cancelled = false;
    QRCode.toDataURL(setup.otpauthUri, { width: 220, margin: 1 })
      .then((url) => { if (!cancelled) setQr(url); })
      .catch(() => { if (!cancelled) setQr(null); });

    return () => { cancelled = true; };
  }, [setup]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['auth', '2fa'] });

  const begin = useMutation({
    mutationFn: () => api.post('/auth/2fa/setup', { password }),
    onSuccess: ({ data }) => { setSetup(data); setPassword(''); },
    onError: (e) => toast.error(e.message),
  });

  const enable = useMutation({
    mutationFn: () => api.post('/auth/2fa/enable', { code: code.trim() }),
    onSuccess: ({ data }) => {
      setRecoveryCodes(data.recoveryCodes);
      setSetup(null);
      setCode('');
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  const disable = useMutation({
    mutationFn: () => api.post('/auth/2fa/disable', { password, code: code.trim() }),
    onSuccess: () => {
      setDisabling(false);
      setPassword('');
      setCode('');
      refresh();
      toast.success('Two-factor authentication is off');
    },
    onError: (e) => toast.error(e.message),
  });

  const regenerate = useMutation({
    mutationFn: () => api.post('/auth/2fa/recovery-codes', { password, code: code.trim() }),
    onSuccess: ({ data }) => {
      setRecoveryCodes(data.recoveryCodes);
      setPassword('');
      setCode('');
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  async function copySecret() {
    try {
      await navigator.clipboard.writeText(setup.secret);
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    } catch {
      toast.error('Could not copy');
    }
  }

  if (isLoading) return null;

  const on = status?.enabled;
  const low = on && status.recoveryCodesRemaining <= 3;

  return (
    <>
      <Card>
        <CardHeader
          icon={on ? ShieldCheck : ShieldAlert}
          title="Two-factor authentication"
          subtitle="A code from your phone, on top of your password."
          action={
            <Badge variant={on ? 'success' : 'neutral'}>{on ? 'On' : 'Off'}</Badge>
          }
        />

        <CardBody className="space-y-4">
          {/* The server decides whether this is possible at all. Saying so
              here beats a failure at the moment somebody tries. */}
          {!status?.configured && (
            <Alert variant="warning" title="Not available on this server">
              TOTP_ENCRYPTION_KEY is not set, so secrets cannot be stored safely. Set it in the
              environment and restart before turning this on.
            </Alert>
          )}

          {!on && !setup && (
            <>
              <p className="text-sm text-ink-600">
                Without this, your password is the only thing protecting the admin console - and
                an admin account can read every customer&apos;s details and download the whole
                database. With it, a stolen password is not enough on its own.
              </p>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <Input
                  label="Confirm your password"
                  type="password"
                  autoComplete="current-password"
                  className="sm:flex-1"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <Button
                  icon={Smartphone}
                  disabled={!status?.configured || password.length === 0}
                  loading={begin.isPending}
                  onClick={() => begin.mutate()}
                >
                  Set up
                </Button>
              </div>
            </>
          )}

          {setup && (
            <div className="space-y-4">
              <ol className="space-y-1 text-sm text-ink-600">
                <li>1. Install Google Authenticator, Authy or any TOTP app.</li>
                <li>2. Scan this code with it.</li>
                <li>3. Type the six digits it shows, to prove it worked.</li>
              </ol>

              <div className="flex flex-col items-start gap-4 sm:flex-row">
                {qr && (
                  <img
                    src={qr}
                    alt="QR code for your authenticator app"
                    className="rounded-card ring-1 ring-ink-200"
                    width={220}
                    height={220}
                  />
                )}

                <div className="min-w-0 flex-1">
                  {/* Always offered, not hidden behind "can't scan?". A camera
                      that will not focus is common, and so is setting this up
                      on the machine the code is displayed on. */}
                  <p className="text-sm font-medium text-ink-700">Or type this key in by hand</p>
                  <p className="mt-1 break-all rounded-field bg-ink-50 px-3 py-2 font-mono text-sm tracking-wider text-ink-900">
                    {setup.secret}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1"
                    icon={copiedSecret ? Check : Copy}
                    onClick={copySecret}
                  >
                    {copiedSecret ? 'Copied' : 'Copy key'}
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <Input
                  label="Code from your app"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  className="sm:flex-1"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                <Button
                  loading={enable.isPending}
                  disabled={code.trim().length !== 6}
                  onClick={() => enable.mutate()}
                >
                  Turn it on
                </Button>
                <Button variant="ghost" onClick={() => { setSetup(null); setCode(''); }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {on && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm text-ink-600">
                <ShieldCheck aria-hidden="true" className="h-4 w-4 text-success-600" />
                <span>
                  You will be asked for a code each time you sign in.
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-ink-50 px-3.5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-900">Recovery codes</p>
                  <p className="text-sm text-ink-500">
                    {status.recoveryCodesRemaining} of 10 left
                  </p>
                </div>
                {low && <Badge variant="warning">Running low</Badge>}
              </div>

              {low && (
                <Alert variant="warning">
                  Generate a new set while you still have a working phone. Each one signs you in
                  once, and running out while your phone is lost means no way back in.
                </Alert>
              )}

              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" icon={RefreshCw} onClick={() => setDisabling('regenerate')}>
                  New recovery codes
                </Button>
                <Button variant="ghost" onClick={() => setDisabling('disable')}>
                  Turn off
                </Button>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      {/* Turning it off and replacing the codes are the same dialog: both
          change how the account is protected, and both need proving twice. */}
      {disabling && (
        <Modal
          open
          onClose={() => { setDisabling(false); setPassword(''); setCode(''); }}
          title={disabling === 'disable' ? 'Turn off two-factor authentication' : 'New recovery codes'}
          description={
            disabling === 'disable'
              ? 'Your password alone will be enough to sign in again.'
              : 'The codes you have now will stop working.'
          }
        >
          <div className="space-y-3">
            <Input
              label="Your password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Input
              label="Code from your app, or a recovery code"
              autoComplete="one-time-code"
              placeholder="123456"
              icon={KeyRound}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />

            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                onClick={() => { setDisabling(false); setPassword(''); setCode(''); }}
              >
                Cancel
              </Button>
              <Button
                variant={disabling === 'disable' ? 'danger' : 'primary'}
                loading={disable.isPending || regenerate.isPending}
                disabled={!password || !code.trim()}
                onClick={() => (disabling === 'disable' ? disable.mutate() : regenerate.mutate())}
              >
                {disabling === 'disable' ? 'Turn it off' : 'Replace them'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {recoveryCodes && (
        <RecoveryCodes codes={recoveryCodes} onClose={() => setRecoveryCodes(null)} />
      )}
    </>
  );
}
