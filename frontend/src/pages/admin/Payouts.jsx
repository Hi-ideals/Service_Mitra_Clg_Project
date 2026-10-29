import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet, Play, AlertTriangle, Hourglass, Download } from 'lucide-react';
import { api } from '../../lib/api.js';
import { keys } from '../../lib/queryClient.js';
import { useToast } from '../../context/ToastContext.jsx';
import Card, { CardBody, CardHeader } from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Input from '../../components/ui/Input.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import Alert from '../../components/ui/Alert.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { PageLoader } from '../../components/ui/Spinner.jsx';
import PayoutDestination from '../../components/admin/PayoutDestination.jsx';
import PayoutCountdown from '../../components/admin/PayoutCountdown.jsx';
import { money, formatDateTime, pluralise } from '../../lib/format.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import PageHeader from '../../components/ui/PageHeader.jsx';

const STATUS_VARIANT = {
  paid: 'success',
  processing: 'info',
  pending: 'warning',
  failed: 'danger',
  on_hold: 'neutral',
};

const STATUS_LABEL = {
  paid: 'paid',
  processing: 'sending',
  pending: 'awaiting transfer',
  failed: 'failed',
  on_hold: 'on hold',
};

export default function Payouts() {
  useDocumentTitle('Payouts');
  const toast = useToast();
  const queryClient = useQueryClient();

  const [confirmOpen, setConfirmOpen] = useState(false);
  // The payout being settled, and which way. Held as one object so the modal
  // can never be open without knowing what it is acting on.
  const [settling, setSettling] = useState(null);
  const [paymentReference, setPaymentReference] = useState('');
  const [failureReason, setFailureReason] = useState('');
  const [exporting, setExporting] = useState(false);

  async function exportHistory() {
    setExporting(true);
    try {
      await api.download('/admin/payouts', {
        params: { format: 'csv', limit: 5000 },
        filename: 'servicemitra-payouts.csv',
      });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setExporting(false);
    }
  }

  const { data: preview, isLoading } = useQuery({
    queryKey: ['admin', 'payouts', 'preview'],
    queryFn: async () => (await api.get('/admin/payouts/preview')).data,
  });

  const { data: awaiting } = useQuery({
    queryKey: ['admin', 'payouts', 'awaiting'],
    queryFn: () => api.get('/admin/payouts', { params: { status: 'pending', limit: 50 } }),
  });

  const { data: history } = useQuery({
    queryKey: keys.admin.payouts({}),
    queryFn: () => api.get('/admin/payouts', { params: { limit: 20 } }),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'payouts'] });

  const closeSettle = () => {
    setSettling(null);
    setPaymentReference('');
    setFailureReason('');
  };

  const isManual = preview?.mode === 'manual';

  const runBatch = useMutation({
    mutationFn: () => api.post('/admin/payouts/run', {}),
    onSuccess: ({ data, message }) => {
      refresh();
      setConfirmOpen(false);
      toast.success(message);
    },
    onError: (e) => toast.error(e.message),
  });

  const prepare = useMutation({
    mutationFn: (providerId) => api.post('/admin/payouts/providers/' + providerId, {}),
    onSuccess: ({ data, message }) => {
      refresh();
      toast.success(message);
    },
    onError: (e) => toast.error(e.message),
  });

  const markPaid = useMutation({
    mutationFn: () =>
      api.post('/admin/payouts/' + settling.id + '/mark-paid', {
        paymentReference: paymentReference.trim(),
      }),
    onSuccess: () => {
      refresh();
      closeSettle();
      toast.success('Recorded as paid. The provider has been notified.');
    },
    onError: (e) => toast.error(e.message),
  });

  const markFailed = useMutation({
    mutationFn: () =>
      api.post('/admin/payouts/' + settling.id + '/mark-failed', { reason: failureReason.trim() }),
    onSuccess: () => {
      refresh();
      closeSettle();
      toast.success('Marked as failed. The earnings are payable again.');
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <PageLoader />;

  const pending = awaiting?.data ?? [];
  const payouts = history?.data ?? [];
  const pendingTotal = pending.reduce((sum, p) => sum + p.amountMinor, 0);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        icon={Wallet}
        title="Payouts"
        description="Only earnings past their dispute window are eligible."
        action={
          <Button icon={Play} disabled={!preview?.count} onClick={() => setConfirmOpen(true)}>
            Prepare all transfers
          </Button>
        }
      />

      {isManual && (
        <Alert variant="info" className="mt-4">
          Transfers are made by hand. Preparing one locks the amount and takes it out of the
          provider&apos;s balance; send the money from your banking app, then record it here with the
          bank reference.
        </Alert>
      )}

      {/* ---------- awaiting the actual transfer ---------- */}
      {pending.length > 0 && (
        <Card className="mt-4">
          <CardHeader
            title="Awaiting transfer"
            subtitle="Money you have committed to send but not yet recorded as sent."
            action={
              <p className="text-lg font-semibold text-ink-900">{money(pendingTotal / 100)}</p>
            }
          />
          <CardBody className="p-0">
            <ul className="divide-y divide-ink-200">
              {pending.map((payout) => (
                <li key={payout.id} className="row-hover px-4 py-3.5 sm:px-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900">
                        Pay {money(payout.amount)} to {payout.providerName}
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-ink-400">{payout.reference}</p>
                    </div>
                    <Badge variant="warning" size="sm">
                      <Hourglass aria-hidden="true" className="mr-1 h-3 w-3" />
                      awaiting transfer
                    </Badge>
                  </div>

                  <PayoutDestination destination={payout.destination} />

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      className="flex-1 sm:flex-none"
                      onClick={() => setSettling({ ...payout, mode: 'paid' })}
                    >
                      Mark as paid
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="flex-1 sm:flex-none"
                      onClick={() => setSettling({ ...payout, mode: 'failed' })}
                    >
                      Transfer failed
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {/* ---------- eligible, not yet committed ---------- */}
      <Card className="mt-4">
        <CardHeader
          title="Money owed"
          subtitle={
            preview?.policy
              ? preview.policy.schedule + ' schedule · minimum ' + money(preview.policy.minimumAmount)
              : undefined
          }
          action={
            preview?.providers?.length ? (
              <div className="text-right">
                <p className="text-lg font-semibold text-ink-900">
                  {money(preview.totalMinor / 100)}
                </p>
                {preview.heldTotalMinor > 0 && (
                  <p className="text-xs text-ink-500">
                    plus {money(preview.heldTotalMinor / 100)} still held
                  </p>
                )}
              </div>
            ) : null
          }
        />
        <CardBody className="p-0">
          {!preview?.providers?.length ? (
            <EmptyState
              compact
              icon={Wallet}
              title="Nobody is owed anything"
              description="Completed jobs appear here as soon as the customer has paid."
            />
          ) : (
            <ul className="divide-y divide-ink-200">
              {preview.providers.map((provider) => (
                <li key={provider.providerId} className="row-hover px-4 py-3.5 sm:px-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900">
                        {money(provider.totalOwed)} owed to {provider.providerName}
                      </p>

                      <p className="mt-0.5 text-sm text-ink-500">
                        {provider.amountMinor > 0 && (
                          <>{money(provider.amount)} ready</>
                        )}
                        {provider.amountMinor > 0 && provider.heldMinor > 0 && ' · '}
                        {provider.heldMinor > 0 && (
                          <>{money(provider.held)} held</>
                        )}
                        {' · '}
                        {pluralise(provider.jobs, 'job')} · oldest{' '}
                        {formatDateTime(provider.oldestEntry)}
                      </p>

                      {/* Says when, not just that it is waiting. An admin
                          looking at a locked button needs to know whether to
                          come back in ten minutes or tomorrow. */}
                      {provider.availableFrom && (
                        <PayoutCountdown
                          className="mt-1.5"
                          until={provider.availableFrom}
                          onElapsed={() =>
                            queryClient.invalidateQueries({ queryKey: ['admin', 'payouts'] })
                          }
                        />
                      )}

                      {provider.blockedBy === 'no_destination' && (
                        <p className="mt-1.5 text-xs font-medium text-danger-600">
                          No payout destination saved — they need to add one before they can be paid.
                        </p>
                      )}

                      {provider.blockedBy === 'below_minimum' && preview.policy && (
                        <p className="mt-1.5 text-xs text-ink-500">
                          Under the {money(preview.policy.minimumAmount)} minimum.
                        </p>
                      )}
                    </div>

                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!provider.canPay}
                      loading={prepare.isPending}
                      onClick={() => prepare.mutate(provider.providerId)}
                    >
                      {isManual ? 'Prepare transfer' : 'Pay'}
                    </Button>
                  </div>

                  <PayoutDestination destination={provider.destination} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* ---------- settled history ---------- */}
      <Card className="mt-4">
        <CardHeader
          title="Payout history"
          action={
            payouts.length > 0 ? (
              <Button
                size="sm"
                variant="secondary"
                icon={Download}
                loading={exporting}
                onClick={exportHistory}
              >
                Export CSV
              </Button>
            ) : null
          }
        />
        <CardBody className="p-0">
          {payouts.length === 0 ? (
            <EmptyState compact icon={Wallet} title="No payouts yet" />
          ) : (
            <ul className="divide-y divide-ink-200">
              {payouts.map((payout) => (
                <li key={payout.id} className="row-hover flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <p className="font-medium text-ink-900">{payout.providerName}</p>
                    <p className="mt-0.5 font-mono text-xs text-ink-400">{payout.reference}</p>
                    {payout.paymentReference && (
                      <p className="mt-0.5 text-sm text-ink-500">
                        Bank ref <span className="font-mono">{payout.paymentReference}</span>
                      </p>
                    )}
                    {payout.failureReason && (
                      <p className="mt-1 flex items-start gap-1.5 text-sm text-danger-700">
                        <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {payout.failureReason}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold tabular-nums text-ink-900">{money(payout.amount)}</p>
                    <Badge variant={STATUS_VARIANT[payout.status]} size="sm" className="mt-1">
                      {STATUS_LABEL[payout.status] ?? payout.status}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* ---------- prepare everything ---------- */}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={isManual ? 'Prepare all transfers?' : 'Run the payout batch?'}
        description={
          preview
            ? money(preview.totalMinor / 100) + ' across ' + pluralise(preview.count, 'provider') + '.'
            : undefined
        }
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button className="flex-1" loading={runBatch.isPending} onClick={() => runBatch.mutate()}>
              {isManual ? 'Prepare transfers' : 'Send payouts'}
            </Button>
          </div>
        }
      >
        <Alert variant="warning">
          {isManual
            ? 'This does not move any money. It locks each amount and takes it out of the provider balance, ready for you to transfer. Providers whose details are missing are skipped.'
            : 'This moves real money. The same earnings can never be paid twice, so a repeated run is safe - but it cannot be undone here.'}
        </Alert>
      </Modal>

      {/* ---------- record what actually happened ---------- */}
      <Modal
        open={Boolean(settling)}
        onClose={closeSettle}
        title={settling?.mode === 'paid' ? 'Record this transfer' : 'Mark the transfer as failed'}
        description={
          settling
            ? money(settling.amount) + ' to ' + settling.providerName + ' · ' + settling.reference
            : undefined
        }
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={closeSettle} className="flex-1">
              Cancel
            </Button>
            {settling?.mode === 'paid' ? (
              <Button
                className="flex-1"
                loading={markPaid.isPending}
                disabled={paymentReference.trim().length < 4}
                onClick={() => markPaid.mutate()}
              >
                Confirm paid
              </Button>
            ) : (
              <Button
                variant="danger"
                className="flex-1"
                loading={markFailed.isPending}
                disabled={failureReason.trim().length < 4}
                onClick={() => markFailed.mutate()}
              >
                Mark failed
              </Button>
            )}
          </div>
        }
      >
        {settling?.mode === 'paid' ? (
          <div className="space-y-3">
            <Input
              label="Bank or UPI reference"
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
              placeholder="UTR or transaction id"
              autoComplete="off"
              spellCheck={false}
              required
              hint="The reference your bank or UPI app returned. This is what anyone traces if the provider says the money never arrived."
            />
            <Alert variant="info">
              Only record this once the money has actually left your account. The provider is told it
              has been sent.
            </Alert>
          </div>
        ) : (
          <div className="space-y-3">
            <Textarea
              label="What went wrong?"
              rows={3}
              maxLength={500}
              required
              value={failureReason}
              onChange={(e) => setFailureReason(e.target.value)}
              hint="The provider sees this, so say what they need to fix."
            />
            <Alert variant="info">
              The earnings go straight back into the provider&apos;s payable balance, so this payout
              can be prepared again once the problem is sorted.
            </Alert>
          </div>
        )}
      </Modal>
    </div>
  );
}
