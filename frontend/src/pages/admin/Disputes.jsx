import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareWarning, Send } from 'lucide-react';
import { api } from '../../lib/api.js';
import { keys } from '../../lib/queryClient.js';
import { useToast } from '../../context/ToastContext.jsx';
import Card from '../../components/ui/Card.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Select from '../../components/ui/Select.jsx';
import Input from '../../components/ui/Input.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import Alert from '../../components/ui/Alert.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { SkeletonCard } from '../../components/ui/Skeleton.jsx';
import { money, formatDateTime, humanise } from '../../lib/format.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import PageHeader from '../../components/ui/PageHeader.jsx';

const PRIORITY_VARIANT = { urgent: 'danger', high: 'warning', normal: 'info', low: 'neutral' };

const RESOLUTIONS = [
  { value: 'full_refund', label: 'Full refund' },
  { value: 'partial_refund', label: 'Partial refund' },
  { value: 'no_refund', label: 'No refund' },
  { value: 'rework', label: 'Provider will redo the work' },
  { value: 'warning_issued', label: 'Warning issued to the provider' },
];

export default function Disputes() {
  useDocumentTitle('Disputes');
  const toast = useToast();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState('open');
  const [openId, setOpenId] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState({ resolutionType: 'no_refund', resolution: '', refundAmount: '' });
  const [message, setMessage] = useState('');

  const { data: counts } = useQuery({
    queryKey: ['admin', 'disputes', 'counts'],
    queryFn: async () => (await api.get('/admin/disputes/counts')).data,
  });

  const { data, isLoading } = useQuery({
    queryKey: keys.disputes.list({ status }),
    queryFn: () => api.get('/disputes', { params: { status, limit: 20 } }),
  });

  const { data: detail } = useQuery({
    queryKey: keys.disputes.detail(openId),
    queryFn: async () => (await api.get('/disputes/' + openId)).data,
    enabled: Boolean(openId),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['disputes'] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'disputes'] });
  };

  const reply = useMutation({
    mutationFn: ({ text, internal }) =>
      api.post('/disputes/' + openId + '/messages', { message: text, isInternal: internal }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.disputes.detail(openId) });
      setMessage('');
    },
    onError: (e) => toast.error(e.message),
  });

  const resolve = useMutation({
    mutationFn: () =>
      api.post('/admin/disputes/' + openId + '/resolve', {
        resolutionType: resolution.resolutionType,
        resolution: resolution.resolution,
        refundAmountMinor:
          resolution.resolutionType === 'partial_refund'
            ? Math.round(Number(resolution.refundAmount) * 100)
            : undefined,
      }),
    onSuccess: ({ data: result }) => {
      refresh();
      setOpenId(null);
      setResolving(false);
      toast.success(
        result.refund
          ? 'Resolved. ' + money(result.refund.amount) + ' refunded.'
          : 'Dispute resolved',
      );
    },
    onError: (e) => toast.error(e.message),
  });

  const disputes = data?.data ?? [];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader icon={MessageSquareWarning} title="Disputes" description="A dispute holds the provider payout until you decide." />

      {counts?.overdue > 0 && (
        <Alert variant="warning" className="mt-4">
          {counts.overdue} dispute{counts.overdue === 1 ? ' has' : 's have'} been open for more
          than three days.
        </Alert>
      )}

      <Tabs
        className="mt-5"
        tabs={[
          { value: 'open', label: 'Open', count: counts?.open },
          { value: 'under_review', label: 'Under review', count: counts?.underReview },
          { value: 'resolved', label: 'Resolved', count: counts?.resolved },
          { value: 'rejected', label: 'Rejected', count: counts?.rejected },
        ]}
        value={status}
        onChange={setStatus}
      />

      <div className="mt-4 space-y-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
        ) : disputes.length === 0 ? (
          <EmptyState icon={MessageSquareWarning} title="Nothing in this queue" />
        ) : (
          disputes.map((dispute) => (
            <Card key={dispute.id} interactive>
              <button type="button" className="w-full p-4 text-left" onClick={() => setOpenId(dispute.id)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-ink-900">{dispute.subject}</p>
                      <Badge variant={PRIORITY_VARIANT[dispute.priority]} size="sm">
                        {dispute.priority}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-sm text-ink-500">
                      {humanise(dispute.category)} · booking {dispute.booking.reference} ·{' '}
                      {dispute.booking.categoryName}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm text-ink-600">{dispute.description}</p>
                    <p className="mt-1.5 text-xs text-ink-400">
                      Raised by the {dispute.raisedByType} · {formatDateTime(dispute.createdAt)}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="font-medium text-ink-900">
                      {money((dispute.booking.finalAmountMinor ?? 0) / 100)}
                    </p>
                    <Badge variant="neutral" size="sm" className="mt-1">
                      {humanise(dispute.status)}
                    </Badge>
                  </div>
                </div>
              </button>
            </Card>
          ))
        )}
      </div>

      <Modal
        open={Boolean(openId)}
        onClose={() => {
          setOpenId(null);
          setResolving(false);
        }}
        title={detail?.subject || 'Loading'}
        description={detail ? 'Booking ' + detail.booking.reference : undefined}
        size="lg"
        footer={
          detail && !detail.resolution && !resolving ? (
            <Button fullWidth onClick={() => setResolving(true)}>
              Resolve this dispute
            </Button>
          ) : null
        }
      >
        {detail && (
          <div className="space-y-4">
            {resolving ? (
              <div className="space-y-4">
                <Alert variant="warning">
                  A refund moves real money and cannot be undone here. It goes through the same
                  ledger as any other refund.
                </Alert>

                <Select
                  label="Outcome"
                  value={resolution.resolutionType}
                  onChange={(e) => setResolution({ ...resolution, resolutionType: e.target.value })}
                  options={RESOLUTIONS}
                />

                {resolution.resolutionType === 'partial_refund' && (
                  <Input
                    label="Refund amount"
                    type="number"
                    min={1}
                    suffix="Rs"
                    required
                    value={resolution.refundAmount}
                    onChange={(e) => setResolution({ ...resolution, refundAmount: e.target.value })}
                    hint={
                      'The booking was ' + money((detail.booking.finalAmountMinor ?? 0) / 100) + '.'
                    }
                  />
                )}

                <Textarea
                  label="Explain your decision"
                  rows={3}
                  maxLength={1000}
                  required
                  value={resolution.resolution}
                  onChange={(e) => setResolution({ ...resolution, resolution: e.target.value })}
                  hint="Both parties see this."
                />

                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setResolving(false)} className="flex-1">
                    Back
                  </Button>
                  <Button
                    className="flex-1"
                    loading={resolve.isPending}
                    disabled={resolution.resolution.trim().length < 10}
                    onClick={() => resolve.mutate()}
                  >
                    Confirm outcome
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="panel-tint p-3">
                  <p className="text-sm font-medium text-ink-700">
                    {humanise(detail.category)} · raised by the {detail.raisedByType}
                  </p>
                  <p className="mt-1 text-base text-ink-600">{detail.description}</p>
                </div>

                {detail.parties && (
                  <dl className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <dt className="text-sm text-ink-500">Customer</dt>
                      <dd className="mt-0.5 font-medium text-ink-900">{detail.parties.customer.name}</dd>
                      <dd className="text-sm text-ink-500">{detail.parties.customer.phone}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-ink-500">Provider</dt>
                      <dd className="mt-0.5 font-medium text-ink-900">{detail.parties.provider.name}</dd>
                    </div>
                  </dl>
                )}

                {detail.resolution && (
                  <Alert variant="success" title={'Resolved: ' + humanise(detail.resolution.type)}>
                    {detail.resolution.notes}
                    {detail.resolution.refundAmountMinor > 0 &&
                      ' · ' + money(detail.resolution.refundAmountMinor / 100) + ' refunded'}
                  </Alert>
                )}

                <div>
                  <p className="mb-2 text-sm font-medium text-ink-700">Conversation</p>
                  <ul className="space-y-2">
                    {detail.messages.map((entry) => (
                      <li
                        key={entry.id}
                        className={
                          'rounded-field p-2.5 ' +
                          (entry.isInternal
                            ? 'border border-dashed border-warning-500/40 bg-warning-50'
                            : 'bg-ink-50')
                        }
                      >
                        <p className="text-xs font-semibold capitalize text-ink-600">
                          {entry.authorName || entry.authorType}
                          {entry.isInternal && ' · internal note'}
                        </p>
                        <p className="mt-1 text-base text-ink-700">{entry.message}</p>
                        <p className="mt-1 text-xs text-ink-400">{formatDateTime(entry.at)}</p>
                      </li>
                    ))}
                    {detail.messages.length === 0 && (
                      <li className="text-base text-ink-500">No messages yet.</li>
                    )}
                  </ul>
                </div>

                {!detail.resolution && (
                  <div className="space-y-2">
                    <Textarea
                      label="Add a message"
                      rows={2}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        icon={Send}
                        loading={reply.isPending}
                        disabled={message.trim().length < 2}
                        onClick={() => reply.mutate({ text: message, internal: false })}
                      >
                        Reply to both
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={message.trim().length < 2}
                        onClick={() => reply.mutate({ text: message, internal: true })}
                      >
                        Internal note
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
