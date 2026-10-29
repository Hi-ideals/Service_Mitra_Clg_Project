import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, MessageSquare, CheckCircle2, XCircle, Send } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import Card, { CardBody, CardHeader } from '../ui/Card.jsx';
import Button from '../ui/Button.jsx';
import Badge from '../ui/Badge.jsx';
import Modal from '../ui/Modal.jsx';
import Input from '../ui/Input.jsx';
import Select from '../ui/Select.jsx';
import Textarea from '../ui/Textarea.jsx';
import Alert from '../ui/Alert.jsx';
import { money, formatDateTime } from '../../lib/format.js';

/** The reasons the API accepts, in the words a customer would use. */
const CATEGORIES = [
  { value: 'work_quality', label: 'The work was poor quality' },
  { value: 'incomplete_work', label: 'The job was not finished' },
  { value: 'damage', label: 'Something was damaged' },
  { value: 'overcharged', label: 'I was charged too much' },
  { value: 'no_show', label: 'They did not turn up' },
  { value: 'behaviour', label: 'How I was treated' },
  { value: 'other', label: 'Something else' },
];

const STATUS_VARIANT = {
  open: 'warning',
  under_review: 'info',
  awaiting_response: 'warning',
  resolved: 'success',
  rejected: 'neutral',
};

const STATUS_LABEL = {
  open: 'open',
  under_review: 'being reviewed',
  awaiting_response: 'awaiting your reply',
  resolved: 'resolved',
  rejected: 'closed',
};

/**
 * Raising and following a dispute, on the booking it concerns.
 *
 * Deliberately here rather than on a page of its own: a customer thinks "there
 * was a problem with this job", not "I would like to browse my disputes". The
 * whole exchange - the complaint, the replies and the outcome - stays attached
 * to the booking it is about.
 */
export default function DisputePanel({ booking, viewer = 'customer', onChanged }) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [reply, setReply] = useState('');
  const [form, setForm] = useState({ category: '', subject: '', description: '' });

  // Scoped to this booking, so the panel never shows someone else's case.
  const { data: list } = useQuery({
    queryKey: ['disputes', 'booking', booking.id],
    queryFn: () => api.get('/disputes', { params: { bookingId: booking.id, limit: 1 } }),
  });

  const existingId = list?.data?.[0]?.id ?? null;

  const { data: dispute } = useQuery({
    queryKey: ['disputes', 'detail', existingId],
    queryFn: async () => (await api.get('/disputes/' + existingId)).data,
    enabled: Boolean(existingId),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['disputes'] });
    onChanged?.();
  };

  const raise = useMutation({
    mutationFn: () =>
      api.post('/disputes', {
        bookingId: booking.id,
        category: form.category,
        subject: form.subject.trim(),
        description: form.description.trim(),
      }),
    onSuccess: () => {
      setFormOpen(false);
      setForm({ category: '', subject: '', description: '' });
      refresh();
      toast.success('Reported. We will look into it and keep you updated.');
    },
    onError: (e) => toast.error(e.message),
  });

  const sendReply = useMutation({
    mutationFn: () => api.post('/disputes/' + existingId + '/messages', { message: reply.trim() }),
    onSuccess: () => {
      setReply('');
      queryClient.invalidateQueries({ queryKey: ['disputes', 'detail', existingId] });
    },
    onError: (e) => toast.error(e.message),
  });

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const fieldError = (name) => raise.error?.fieldErrors?.[name];

  const canRaise =
    viewer === 'customer' &&
    booking.status === 'completed' &&
    booking.disputeWindowEndsAt &&
    new Date(booking.disputeWindowEndsAt) > new Date();

  // ---------- nothing raised yet ----------
  if (!existingId) {
    if (!canRaise) return null;

    return (
      <>
        <Card className="mt-4">
          <CardBody>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-ink-900">Was something wrong with this job?</p>
                <p className="mt-0.5 text-sm text-ink-500">
                  You can report it until {formatDateTime(booking.disputeWindowEndsAt)}. The
                  professional is not paid while we look into it.
                </p>
              </div>
              <Button
                variant="secondary"
                icon={ShieldAlert}
                className="shrink-0"
                onClick={() => setFormOpen(true)}
              >
                Report a problem
              </Button>
            </div>
          </CardBody>
        </Card>

        <Modal
          open={formOpen}
          onClose={() => setFormOpen(false)}
          title="Report a problem"
          description={booking.reference + ' · ' + (booking.categoryName ?? '')}
          footer={
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setFormOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                loading={raise.isPending}
                disabled={
                  !form.category || form.subject.trim().length < 5 || form.description.trim().length < 20
                }
                onClick={() => raise.mutate()}
              >
                Report it
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <Select
              label="What went wrong?"
              value={form.category}
              onChange={set('category')}
              error={fieldError('category')}
              required
            >
              <option value="">Choose a reason</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>

            <Input
              label="In one line"
              value={form.subject}
              onChange={set('subject')}
              error={fieldError('subject')}
              maxLength={150}
              required
              placeholder="Tap still leaking after the repair"
            />

            <Textarea
              label="What happened?"
              rows={4}
              maxLength={2000}
              value={form.description}
              onChange={set('description')}
              error={fieldError('description')}
              required
              hint="At least 20 characters. The professional sees this, so say what you would say to them."
            />

            <Alert variant="info">
              Reporting this puts the professional&apos;s payment on hold until we decide. You can
              be refunded in full or in part.
            </Alert>
          </div>
        </Modal>
      </>
    );
  }

  // ---------- one exists ----------
  if (!dispute) return null;

  const closed = Boolean(dispute.resolution);
  const refunded = dispute.resolution?.refundAmountMinor;

  return (
    <Card className="mt-4">
      <CardHeader
        title="Reported problem"
        subtitle={dispute.subject}
        action={
          <Badge variant={STATUS_VARIANT[dispute.status]} size="sm">
            {STATUS_LABEL[dispute.status] ?? dispute.status}
          </Badge>
        }
      />
      <CardBody className="space-y-4">
        <p className="font-mono text-xs text-ink-400">{dispute.reference}</p>

        {closed && (
          <Alert variant={dispute.status === 'resolved' ? 'success' : 'info'}>
            <span className="flex items-start gap-2">
              {dispute.status === 'resolved' ? (
                <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <XCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span>
                {dispute.resolution.notes}
                {refunded > 0 && (
                  <strong className="mt-1 block">
                    {money(refunded / 100)} has been refunded to you.
                  </strong>
                )}
              </span>
            </span>
          </Alert>
        )}

        <div>
          <p className="text-sm text-ink-700">{dispute.description}</p>
          <p className="mt-1 text-xs text-ink-400">Reported {formatDateTime(dispute.createdAt)}</p>
        </div>

        {dispute.messages?.length > 0 && (
          <ul className="space-y-2.5 border-t border-ink-200 pt-4">
            {dispute.messages.map((m) => (
              <li
                key={m.id}
                className={
                  'rounded-field p-3 ' +
                  (m.authorType === viewer ? 'bg-brand-50/60 sm:ml-8' : 'bg-ink-50 sm:mr-8')
                }
              >
                <p className="text-xs font-medium text-ink-500">
                  {m.authorType === viewer ? 'You' : m.authorName || m.authorType}
                  <span className="ml-1.5 font-normal text-ink-400">{formatDateTime(m.at)}</span>
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink-800">{m.message}</p>
              </li>
            ))}
          </ul>
        )}

        {closed ? (
          <p className="flex items-center gap-1.5 text-sm text-ink-500">
            <MessageSquare aria-hidden="true" className="h-3.5 w-3.5" />
            This is closed, so no more replies can be added.
          </p>
        ) : (
          <div className="flex items-end gap-2 border-t border-ink-200 pt-4">
            <Textarea
              containerClassName="flex-1"
              label="Add a reply"
              rows={2}
              maxLength={2000}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
            />
            <Button
              icon={Send}
              className="mb-0.5 shrink-0"
              loading={sendReply.isPending}
              disabled={reply.trim().length < 2}
              onClick={() => sendReply.mutate()}
            >
              Send
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
