import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Star, MessageSquare, Flag, Send } from 'lucide-react';
import { api } from '../../lib/api.js';
import { keys } from '../../lib/queryClient.js';
import { useToast } from '../../context/ToastContext.jsx';
import Card, { CardBody, CardHeader } from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import Avatar from '../../components/ui/Avatar.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import StarRating from '../../components/ui/StarRating.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { PageLoader } from '../../components/ui/Spinner.jsx';
import { formatDate } from '../../lib/format.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';

const SUB_LABELS = {
  punctuality: 'Turning up on time',
  quality: 'Quality of work',
  behaviour: 'How you treated them',
};

/**
 * The bars under the average, so a provider can see the shape of their score
 * rather than one number. Four fives and a one average out to the same 4.2 as
 * five fours, and those are very different businesses.
 */
function Distribution({ distribution }) {
  return (
    <div className="space-y-1.5">
      {[5, 4, 3, 2, 1].map((stars) => {
        const row = distribution?.[stars] ?? { count: 0, percent: 0 };
        return (
          <div key={stars} className="flex items-center gap-2 text-sm">
            <span className="w-3 text-right font-medium text-ink-600">{stars}</span>
            <Star aria-hidden="true" className="h-3 w-3 shrink-0 fill-warning-400 text-warning-400" />
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
              <div
                className="h-full rounded-full bg-warning-400"
                style={{ width: row.percent + '%' }}
              />
            </div>
            <span className="w-6 text-right text-xs tabular-nums text-ink-500">{row.count}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function ProviderReviews() {
  useDocumentTitle('Reviews');
  const toast = useToast();
  const queryClient = useQueryClient();

  const [replyTo, setReplyTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [reportOf, setReportOf] = useState(null);
  const [reportReason, setReportReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: keys.reviews.received,
    queryFn: () => api.get('/reviews/received', { params: { limit: 50 } }),
  });

  const reply = useMutation({
    mutationFn: () => api.post('/reviews/' + replyTo.id + '/reply', { reply: replyText.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.reviews.received });
      setReplyTo(null);
      setReplyText('');
      toast.success('Your reply is published under the review');
    },
    onError: (error) => toast.error(error.message),
  });

  const report = useMutation({
    mutationFn: () =>
      api.post('/reviews/' + reportOf.id + '/report', { reason: reportReason.trim() }),
    onSuccess: () => {
      setReportOf(null);
      setReportReason('');
      toast.success('Reported. An administrator will look at it.');
    },
    onError: (error) => toast.error(error.message),
  });

  if (isLoading) return <PageLoader label="Loading your reviews" />;

  const reviews = data?.data ?? [];
  const summary = data?.meta?.summary;

  return (
    <div className="page max-w-4xl py-5 sm:py-7">
      <PageHeader
        icon={Star}
        title="Reviews"
        description="What customers said after you finished their job."
      />

      {summary?.count > 0 && (
        <Card className="mt-5">
          <CardBody className="grid gap-5 sm:grid-cols-3">
            <div className="flex flex-col items-center justify-center text-center">
              <p className="text-4xl font-semibold text-ink-900">
                {summary.average.toFixed(1)}
              </p>
              <StarRating value={Math.round(summary.average)} size="sm" className="mt-1.5" />
              <p className="mt-1 text-sm text-ink-500">
                {summary.count} {summary.count === 1 ? 'review' : 'reviews'}
              </p>
            </div>

            <Distribution distribution={summary.distribution} />

            <div className="space-y-2">
              {Object.entries(SUB_LABELS).map(([key, label]) => (
                <div key={key}>
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-ink-500">{label}</span>
                    <span className="text-sm font-semibold text-ink-800">
                      {Number(summary.subRatings?.[key] ?? 0).toFixed(1)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{ width: ((summary.subRatings?.[key] ?? 0) / 5) * 100 + '%' }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      <div className="mt-5 space-y-3">
        {reviews.length === 0 ? (
          <EmptyState
            icon={Star}
            title="No reviews yet"
            description="A customer can rate you once you have completed their job. Reviews are the main thing people read before booking, so the first few matter."
          />
        ) : (
          reviews.map((review) => (
            <Card key={review.id}>
              <CardBody>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <Avatar
                      name={review.customer?.name}
                      src={review.customer?.avatarUrl}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-900">
                        {review.customer?.name ?? 'A customer'}
                      </p>
                      <p className="mt-0.5 text-sm text-ink-500">
                        {review.categoryName} · {formatDate(review.createdAt)}
                        {review.bookingReference && (
                          <span className="font-mono text-xs text-ink-400">
                            {' · ' + review.bookingReference}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <StarRating value={review.rating} size="sm" />
                </div>

                {review.title && <p className="mt-2 font-medium text-ink-800">{review.title}</p>}
                {review.comment && <p className="mt-1 text-base text-ink-600">{review.comment}</p>}

                {review.reply ? (
                  <div className="mt-3 rounded-field border-l-2 border-brand-300 bg-ink-50 px-3 py-2">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-700">
                      <MessageSquare aria-hidden="true" className="h-3.5 w-3.5" />
                      Your reply
                    </p>
                    <p className="mt-1 text-sm text-ink-600">{review.reply.text}</p>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={MessageSquare}
                      onClick={() => { setReplyTo(review); setReplyText(''); }}
                    >
                      Reply
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={Flag}
                      onClick={() => { setReportOf(review); setReportReason(''); }}
                    >
                      Report
                    </Button>
                  </div>
                )}
              </CardBody>
            </Card>
          ))
        )}
      </div>

      <Modal
        open={Boolean(replyTo)}
        onClose={() => setReplyTo(null)}
        title="Reply to this review"
        description="Everyone who looks at your profile sees this under the review. You get one reply, and it cannot be edited afterwards."
      >
        <Textarea
          label="Your reply"
          rows={4}
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          placeholder="Thank them, or explain what happened. Keep it short and civil - this is read by future customers, not only by the person who wrote the review."
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setReplyTo(null)}>Cancel</Button>
          <Button
            icon={Send}
            loading={reply.isPending}
            disabled={replyText.trim().length < 2}
            onClick={() => reply.mutate()}
          >
            Post reply
          </Button>
        </div>
      </Modal>

      <Modal
        open={Boolean(reportOf)}
        onClose={() => setReportOf(null)}
        title="Report this review"
        description="For reviews that are abusive, or that are not about a job you did. An administrator reads every report."
      >
        <Textarea
          label="What is wrong with it?"
          rows={3}
          value={reportReason}
          onChange={(e) => setReportReason(e.target.value)}
          placeholder="Say what makes this review unfair or untrue."
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setReportOf(null)}>Cancel</Button>
          <Button
            variant="danger"
            icon={Flag}
            loading={report.isPending}
            disabled={reportReason.trim().length < 5}
            onClick={() => report.mutate()}
          >
            Report it
          </Button>
        </div>
      </Modal>
    </div>
  );
}
