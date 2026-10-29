import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, FileText, ExternalLink, Clock, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import Card from '../../components/ui/Card.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import Alert from '../../components/ui/Alert.jsx';
import Avatar from '../../components/ui/Avatar.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { SkeletonCard } from '../../components/ui/Skeleton.jsx';
import { formatDateTime, pluralise } from '../../lib/format.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import PageHeader from '../../components/ui/PageHeader.jsx';

export default function VerificationQueue() {
  useDocumentTitle('Verification queue');
  const toast = useToast();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState('pending');
  const [openId, setOpenId] = useState(null);
  const [action, setAction] = useState(null);
  const [note, setNote] = useState('');

  const { data: counts } = useQuery({
    queryKey: ['admin', 'kyc', 'counts'],
    queryFn: async () => (await api.get('/admin/kyc/counts')).data,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'kyc', status],
    queryFn: () => api.get('/admin/kyc', { params: { status, limit: 20 } }),
  });

  const { data: detail } = useQuery({
    queryKey: ['admin', 'kyc', 'detail', openId],
    queryFn: async () => (await api.get('/admin/kyc/' + openId)).data,
    enabled: Boolean(openId),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'kyc'] });

  const decide = useMutation({
    mutationFn: ({ id, kind, text }) => {
      if (kind === 'approve') return api.post('/admin/kyc/' + id + '/approve', { notes: text || undefined });
      if (kind === 'reject') return api.post('/admin/kyc/' + id + '/reject', { reason: text });
      return api.post('/admin/kyc/' + id + '/request-info', { message: text });
    },
    onSuccess: (_result, variables) => {
      refresh();
      setAction(null);
      setNote('');
      setOpenId(null);
      toast.success(
        variables.kind === 'approve'
          ? 'Provider verified and cleared to go live'
          : variables.kind === 'reject'
            ? 'Submission rejected'
            : 'Information requested',
      );
    },
    onError: (error) => toast.error(error.message),
  });

  const submissions = data?.data ?? [];

  const tabs = [
    { value: 'pending', label: 'Pending', count: counts?.pending },
    { value: 'info_requested', label: 'Info requested', count: counts?.infoRequested },
    { value: 'approved', label: 'Approved', count: counts?.approved },
    { value: 'rejected', label: 'Rejected', count: counts?.rejected },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader icon={ShieldCheck} title="Verification" description="A provider cannot appear in search or take a booking until you approve them." />

      {counts?.waitingOver48h > 0 && (
        <Alert variant="warning" className="mt-4">
          {pluralise(counts.waitingOver48h, 'provider has', 'providers have')} been waiting more
          than 48 hours. Every day of delay is a day they earn nothing.
        </Alert>
      )}

      <Tabs className="mt-5" tabs={tabs} value={status} onChange={setStatus} />

      <div className="mt-4 space-y-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
        ) : submissions.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="Nothing in this queue"
            description={status === 'pending' ? 'Every submission has been reviewed.' : undefined}
          />
        ) : (
          submissions.map((item) => (
            <Card key={item.id} interactive>
              <button type="button" className="w-full p-4 text-left" onClick={() => setOpenId(item.id)}>
                <div className="flex items-start gap-3">
                  <Avatar src={item.provider.avatarUrl} name={item.provider.fullName} size="md" />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-ink-900">
                        {item.provider.businessName || item.provider.fullName}
                      </p>
                      {item.needsCertification && (
                        <Badge variant="warning" size="sm">
                          <AlertTriangle aria-hidden="true" className="h-3 w-3" />
                          Licensed trade
                        </Badge>
                      )}
                    </div>

                    <p className="mt-0.5 text-sm text-ink-500">
                      Legal name: {item.legalName} · {item.idProofType.replace('_', ' ')}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-500">
                      {item.city}, {item.state} · {pluralise(item.serviceCount, 'service')} listed
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                      <span className="flex items-center gap-1 text-ink-500">
                        <FileText aria-hidden="true" className="h-3.5 w-3.5" />
                        {pluralise(item.documentCount, 'document')}
                      </span>
                      <span className="flex items-center gap-1 text-ink-500">
                        <Clock aria-hidden="true" className="h-3.5 w-3.5" />
                        Waiting {pluralise(item.waitingDays, 'day')}
                      </span>
                    </div>
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
          setAction(null);
          setNote('');
        }}
        title={detail ? detail.provider.businessName || detail.provider.fullName : 'Loading'}
        description={detail ? 'Submitted ' + formatDateTime(detail.submittedAt) : undefined}
        size="lg"
        footer={
          detail && !action ? (
            <div className="flex flex-wrap gap-2">
              <Button
                className="flex-1"
                loading={decide.isPending}
                onClick={() => decide.mutate({ id: detail.id, kind: 'approve' })}
              >
                Approve
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => setAction('request-info')}>
                Ask for more
              </Button>
              <Button variant="danger" className="flex-1" onClick={() => setAction('reject')}>
                Reject
              </Button>
            </div>
          ) : null
        }
      >
        {detail && action && (
          <div className="space-y-4">
            <Textarea
              label={action === 'reject' ? 'Why are you rejecting this?' : 'What do you need from them?'}
              rows={4}
              maxLength={500}
              required
              value={note}
              onChange={(e) => setNote(e.target.value)}
              hint="The provider sees this, so make it specific enough to act on."
            />
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setAction(null)} className="flex-1">
                Back
              </Button>
              <Button
                variant={action === 'reject' ? 'danger' : 'primary'}
                className="flex-1"
                loading={decide.isPending}
                disabled={note.trim().length < 10}
                onClick={() =>
                  decide.mutate({
                    id: detail.id,
                    kind: action === 'reject' ? 'reject' : 'request-info',
                    text: note,
                  })
                }
              >
                {action === 'reject' ? 'Reject submission' : 'Send request'}
              </Button>
            </div>
          </div>
        )}

        {detail && !action && (
          <div className="space-y-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              {[
                ['Legal name', detail.fullLegalName],
                ['ID type', detail.idProofType.replace('_', ' ')],
                ['ID ends in', detail.idProofLast4],
                ['Phone', detail.provider.phone],
                ['Address', detail.address.line],
                ['Area', detail.address.city + ' ' + detail.address.pincode],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-sm text-ink-500">{label}</dt>
                  <dd className="mt-0.5 font-medium capitalize text-ink-900">{value || 'Not given'}</dd>
                </div>
              ))}
            </dl>

            <div>
              <p className="mb-2 text-sm font-medium text-ink-700">Documents</p>
              {detail.documents.length === 0 ? (
                <Alert variant="warning">
                  No documents uploaded. This submission cannot be approved.
                </Alert>
              ) : (
                <ul className="space-y-2">
                  {detail.documents.map((doc) => (
                    <li
                      key={doc.id}
                      className="flex items-center justify-between gap-3 panel-tint rounded-field p-2.5"
                    >
                      <div className="flex min-w-0 gap-2">
                        <FileText aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                        <div className="min-w-0">
                          <p className="font-medium capitalize text-ink-900">
                            {doc.docType.replace('_', ' ')}
                          </p>
                          <p className="truncate text-sm text-ink-500">{doc.originalName}</p>
                        </div>
                      </div>
                      {/* A signed URL valid for minutes, never a raw storage path. */}
                      <Button
                        as="a"
                        href={doc.url}
                        target="_blank"
                        rel="noreferrer"
                        variant="secondary"
                        size="sm"
                        iconRight={ExternalLink}
                        className="shrink-0"
                      >
                        Open
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
