import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Star, Flag, EyeOff, Eye } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import Card, { CardBody } from '../../components/ui/Card.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import StarRating from '../../components/ui/StarRating.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Alert from '../../components/ui/Alert.jsx';
import { SkeletonCard } from '../../components/ui/Skeleton.jsx';
import { formatDate, pluralise } from '../../lib/format.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import PageHeader from '../../components/ui/PageHeader.jsx';

export default function AdminReviews() {
  useDocumentTitle('Review moderation');
  const toast = useToast();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState('flagged');
  const [moderating, setModerating] = useState(null);
  const [reason, setReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'reviews', status],
    queryFn: () => api.get('/admin/reviews', { params: { status, limit: 20 } }),
  });

  const moderate = useMutation({
    mutationFn: ({ id, nextStatus, text }) =>
      api.patch('/admin/reviews/' + id, { status: nextStatus, reason: text || undefined }),
    onSuccess: (_r, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'reviews'] });
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      setModerating(null);
      setReason('');
      toast.success(
        variables.nextStatus === 'published'
          ? 'Review restored and the provider rating recalculated'
          : 'Review hidden and the provider rating recalculated',
      );
    },
    onError: (e) => toast.error(e.message),
  });

  const reviews = data?.data ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader icon={Star} title="Review moderation" description="Hiding a review recomputes the provider rating immediately." />

      <Alert variant="info" className="mt-4">
        A reported review is flagged for a human decision, not hidden automatically - otherwise a
        few coordinated reports could silence an honest one-star review.
      </Alert>

      <Tabs
        className="mt-5"
        tabs={[
          { value: 'flagged', label: 'Flagged' },
          { value: 'hidden', label: 'Hidden' },
          { value: 'published', label: 'Published' },
          { value: 'removed', label: 'Removed' },
        ]}
        value={status}
        onChange={setStatus}
      />

      <div className="mt-4 space-y-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
        ) : reviews.length === 0 ? (
          <EmptyState
            icon={Star}
            title="Nothing here"
            description={status === 'flagged' ? 'No reviews have been reported.' : undefined}
          />
        ) : (
          reviews.map((review) => (
            <Card key={review.id}>
              <CardBody>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StarRating value={review.rating} size="sm" />
                      {review.reportCount > 0 && (
                        <Badge variant="danger" size="sm">
                          <Flag aria-hidden="true" className="h-3 w-3" />
                          {pluralise(review.reportCount, 'report')}
                        </Badge>
                      )}
                      <Badge variant="neutral" size="sm">{review.status}</Badge>
                    </div>

                    <p className="mt-1.5 text-sm text-ink-500">
                      {review.customer?.name} on {review.provider?.name} · {formatDate(review.createdAt)}
                    </p>

                    {review.title && <p className="mt-2 font-medium text-ink-900">{review.title}</p>}
                    {review.comment && <p className="mt-1 text-base text-ink-600">{review.comment}</p>}

                    {review.reports?.length > 0 && (
                      <ul className="mt-3 space-y-1 rounded-field bg-danger-50 p-2.5">
                        {review.reports.map((report, index) => (
                          <li key={index} className="text-sm text-danger-700">
                            <span className="font-medium capitalize">{report.reason}</span>
                            {report.details && ': ' + report.details}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col gap-1.5">
                    {review.status !== 'published' ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={Eye}
                        loading={moderate.isPending}
                        onClick={() => moderate.mutate({ id: review.id, nextStatus: 'published' })}
                      >
                        Restore
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={EyeOff}
                        onClick={() => setModerating({ id: review.id, nextStatus: 'hidden' })}
                      >
                        Hide
                      </Button>
                    )}
                  </div>
                </div>
              </CardBody>
            </Card>
          ))
        )}
      </div>

      <Modal
        open={Boolean(moderating)}
        onClose={() => setModerating(null)}
        title="Hide this review?"
        description="The provider rating is recalculated straight away, and the customer is told."
      >
        <div className="space-y-4">
          <Textarea
            label="Reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            hint="The customer sees this."
          />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setModerating(null)} className="flex-1">
              Cancel
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              loading={moderate.isPending}
              onClick={() => moderate.mutate({ ...moderating, text: reason })}
            >
              Hide review
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
