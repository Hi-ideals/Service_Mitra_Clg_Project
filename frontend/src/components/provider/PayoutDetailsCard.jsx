import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Landmark, Smartphone, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../lib/api.js';
import Card, { CardBody, CardHeader } from '../ui/Card.jsx';
import Button from '../ui/Button.jsx';
import Input from '../ui/Input.jsx';
import Badge from '../ui/Badge.jsx';
import Alert from '../ui/Alert.jsx';
import { useToast } from '../../context/ToastContext.jsx';

const EMPTY = {
  useUpi: true,
  useBank: false,
  preferred: 'upi',
  upiId: '',
  accountName: '',
  accountNumber: '',
  ifsc: '',
  bankName: '',
};

/**
 * Where this provider gets paid.
 *
 * Both a UPI id and a bank account can be held at once - UPI for the quick
 * ones, the bank for the large ones - and one of them is marked preferred.
 * The payout queue still pays to exactly one destination; holding the other
 * only saves retyping it.
 *
 * What is submitted is the whole picture, not a patch: a section left
 * unticked is removed. That is deliberate, and it is how a provider deletes a
 * destination they no longer want.
 */
export default function PayoutDetailsCard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['provider', 'payout-method'],
    queryFn: async () => (await api.get('/providers/me/payout-method')).data,
  });

  // Seed the form from whatever is saved, but never while the provider is
  // mid-edit - a background refetch must not overwrite what they are typing.
  useEffect(() => {
    if (!data || editing) return;
    const hasUpi = Boolean(data.upiId);
    const hasBank = Boolean(data.accountNumber);
    setForm({
      // A provider with nothing saved starts on UPI, which is what most of
      // them use and the quicker of the two to fill in.
      useUpi: hasUpi || (!hasUpi && !hasBank),
      useBank: hasBank,
      preferred: data.method || 'upi',
      upiId: data.upiId || '',
      accountName: data.accountName || '',
      accountNumber: data.accountNumber || '',
      ifsc: data.ifsc || '',
      bankName: data.bankName || '',
    });
  }, [data, editing]);

  const save = useMutation({
    mutationFn: () => {
      const payload = { preferred: form.preferred };

      if (form.useUpi) {
        payload.upi = { upiId: form.upiId.trim() };
      }
      if (form.useBank) {
        payload.bank = {
          accountName: form.accountName.trim(),
          accountNumber: form.accountNumber.trim(),
          ifsc: form.ifsc.trim(),
          ...(form.bankName.trim() ? { bankName: form.bankName.trim() } : {}),
        };
      }
      return api.put('/providers/me/payout-method', payload);
    },
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ['provider', 'payout-method'] });
      toast.success('Payout details saved');
    },
    onError: (e) => toast.error(e.message),
  });

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const fieldError = (name) => save.error?.fieldErrors?.[name];

  const saved = data?.isComplete ? data : null;
  const savedHasUpi = Boolean(saved?.upiId);
  const savedHasBank = Boolean(saved?.accountNumber);

  /**
   * Keeps `preferred` pointing at something that exists.
   *
   * Unticking the preferred section would otherwise submit a preference for a
   * destination that is not being sent, which the server refuses - correctly,
   * but the provider would have to work out why from an error on a checkbox
   * they just cleared.
   */
  function toggleSection(section, on) {
    setForm((f) => {
      const next = { ...f, [section === 'upi' ? 'useUpi' : 'useBank']: on };
      if (!on && f.preferred === section) {
        next.preferred = section === 'upi' ? 'bank' : 'upi';
      }
      if (on && !f.useUpi && !f.useBank) next.preferred = section;
      return next;
    });
  }

  if (isLoading) return null;

  const bothOn = form.useUpi && form.useBank;

  return (
    <Card className="mt-4">
      <CardHeader
        title="Where you get paid"
        subtitle="Released earnings are transferred here. Keep it current."
        action={
          saved && !editing ? (
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Change
            </Button>
          ) : null
        }
      />

      <CardBody>
        {!saved && !editing && (
          <Alert variant="warning">
            You have not added a payout destination yet. Your earnings are safe, but they cannot be
            transferred to you until you add one.
            <div className="mt-2.5">
              <Button size="sm" onClick={() => setEditing(true)}>
                Add payout details
              </Button>
            </div>
          </Alert>
        )}

        {saved && !editing && (
          <div className="space-y-3">
            {savedHasUpi && (
              <div className="flex items-start gap-3">
                <Smartphone aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="break-all font-medium text-ink-900">{saved.upiId}</span>
                    {saved.method === 'upi' && (
                      <Badge variant="info" size="sm">Preferred</Badge>
                    )}
                  </p>
                </div>
              </div>
            )}

            {savedHasBank && (
              <div className="flex items-start gap-3">
                <Landmark aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink-900">{saved.accountName}</span>
                    {saved.method === 'bank' && (
                      <Badge variant="info" size="sm">Preferred</Badge>
                    )}
                  </p>
                  <p className="mt-0.5 break-all text-sm tabular-nums text-ink-600">
                    {saved.accountNumber} · {saved.ifsc}
                  </p>
                  {saved.bankName && <p className="text-sm text-ink-500">{saved.bankName}</p>}
                </div>
              </div>
            )}

            <p className="flex items-center gap-1.5 text-xs text-ink-400">
              <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
              Only you and the ServiceMitra finance team can see this.
            </p>
          </div>
        )}

        {editing && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
            className="space-y-4"
          >
            <p className="text-sm text-ink-500">
              Add either or both. If you add both, choose which one we should use.
            </p>

            {/* ------------------------------------------------------- UPI */}
            <div
              className={clsx(
                'rounded-field border p-3.5 transition-colors',
                form.useUpi ? 'border-brand-600 bg-brand-50/40' : 'border-ink-300',
              )}
            >
              <label className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={form.useUpi}
                  onChange={(e) => toggleSection('upi', e.target.checked)}
                  className="h-4 w-4 accent-brand-600"
                />
                <Smartphone aria-hidden="true" className="h-4 w-4 text-ink-500" />
                <span>
                  <span className="block text-sm font-medium text-ink-900">UPI</span>
                  <span className="block text-xs text-ink-500">Usually instant</span>
                </span>
              </label>

              {form.useUpi && (
                <div className="mt-3">
                  <Input
                    label="UPI id"
                    value={form.upiId}
                    onChange={set('upiId')}
                    error={fieldError('upi.upiId') ?? fieldError('upiId')}
                    placeholder="name@bank"
                    autoComplete="off"
                    spellCheck={false}
                    required
                    hint="The id you would give someone paying you on any UPI app."
                  />
                </div>
              )}
            </div>

            {/* ------------------------------------------------------ bank */}
            <div
              className={clsx(
                'rounded-field border p-3.5 transition-colors',
                form.useBank ? 'border-brand-600 bg-brand-50/40' : 'border-ink-300',
              )}
            >
              <label className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={form.useBank}
                  onChange={(e) => toggleSection('bank', e.target.checked)}
                  className="h-4 w-4 accent-brand-600"
                />
                <Landmark aria-hidden="true" className="h-4 w-4 text-ink-500" />
                <span>
                  <span className="block text-sm font-medium text-ink-900">Bank account</span>
                  <span className="block text-xs text-ink-500">NEFT or IMPS</span>
                </span>
              </label>

              {form.useBank && (
                <div className="mt-3 space-y-4">
                  <Input
                    label="Name on the account"
                    value={form.accountName}
                    onChange={set('accountName')}
                    error={fieldError('bank.accountName') ?? fieldError('accountName')}
                    required
                  />
                  <Input
                    label="Account number"
                    value={form.accountNumber}
                    onChange={set('accountNumber')}
                    error={fieldError('bank.accountNumber') ?? fieldError('accountNumber')}
                    inputMode="numeric"
                    autoComplete="off"
                    spellCheck={false}
                    required
                  />
                  <Input
                    label="IFSC code"
                    value={form.ifsc}
                    onChange={(e) => setForm((f) => ({ ...f, ifsc: e.target.value.toUpperCase() }))}
                    error={fieldError('bank.ifsc') ?? fieldError('ifsc')}
                    placeholder="HDFC0001234"
                    autoComplete="off"
                    spellCheck={false}
                    required
                  />
                  <Input
                    label="Bank name"
                    value={form.bankName}
                    onChange={set('bankName')}
                    error={fieldError('bank.bankName') ?? fieldError('bankName')}
                    hint="Optional, but it helps us spot a wrong IFSC before the money moves."
                  />
                </div>
              )}
            </div>

            {/* The choice only exists when there is something to choose. With
                one destination saved, asking which to use is a question with
                one answer. */}
            {bothOn && (
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium text-ink-700">
                  Which should we use?
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    { value: 'upi', label: 'Pay me on UPI', icon: Smartphone },
                    { value: 'bank', label: 'Pay me to the bank', icon: Landmark },
                  ].map((option) => (
                    <label
                      key={option.value}
                      className={clsx(
                        'flex cursor-pointer items-center gap-2.5 rounded-field border p-3 transition-colors',
                        form.preferred === option.value
                          ? 'border-brand-600 bg-brand-50/60 ring-1 ring-brand-600/25'
                          : 'border-ink-300 hover:bg-ink-50',
                      )}
                    >
                      <input
                        type="radio"
                        name="preferred-payout"
                        value={option.value}
                        checked={form.preferred === option.value}
                        onChange={set('preferred')}
                        className="h-4 w-4 accent-brand-600"
                      />
                      <option.icon aria-hidden="true" className="h-4 w-4 text-ink-500" />
                      <span className="text-sm font-medium text-ink-900">{option.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {!form.useUpi && !form.useBank && (
              <Alert variant="warning">Add a UPI id or a bank account to be paid.</Alert>
            )}

            <div className="flex gap-2">
              {saved && (
                <Button
                  type="button"
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
              )}
              <Button
                type="submit"
                className="flex-1"
                loading={save.isPending}
                disabled={!form.useUpi && !form.useBank}
              >
                Save details
              </Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
