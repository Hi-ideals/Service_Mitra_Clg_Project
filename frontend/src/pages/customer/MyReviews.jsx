import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Star, MessageSquare } from 'lucide-react';
import { api } from '../../lib/api.js';
import { keys } from '../../lib/queryClient.js';
import Card, { CardBody, CardHeader } from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import StarRating from '../../components/ui/StarRating.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { PageLoader } from '../../components/ui/Spinner.jsx';
import { formatDate, relativeDay } from '../../lib/format.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import PageHeader from '../../components/ui/PageHeader.jsx';

export default function MyReviews() {
  useDocumentTitle('My reviews');
  const { data, isLoading } = useQuery({
    queryKey: keys.reviews.mine,
    queryFn: () => api.get('/reviews/mine', { params: { limit: 20 } }),
  });

  const { data: pending } = useQuery({
    queryKey: keys.reviews.pending,
    queryFn: async () => (await api.get('/reviews/pending')).data,
  });

  if (isLoading) return <PageLoader />;

  const reviews = data?.data ?? [];

  return (
    <div className="page max-w-3xl py-5 sm:py-7">
      <PageHeader icon={Star} title="My reviews" />

      {pending?.length > 0 && (
        <Card className="mt-4">
          <CardHeader
            title="Waiting for your review"
            subtitle="Reviews close 30 days after a job is completed."
          />
          <CardBody className="divide-y divide-ink-200">
            {pending.map((item) => (
              <div key={item.bookingId} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink-900">{item.providerName}</p>
                  <p className="mt-0.5 text-sm text-ink-500">
                    {item.categoryName} · completed {relativeDay(item.completedAt).toLowerCase()}
                  </p>
                </div>
                <Button as={Link} to={'/bookings/' + item.bookingId} size="sm" icon={Star} className="shrink-0">
                  Rate
                </Button>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      <div className="mt-4 space-y-3">
        {reviews.length === 0 ? (
          <EmptyState
            icon={Star}
            title="You have not written a review yet"
            description="After a job is completed you can rate the professional, which is how other customers decide who to trust."
          />
        ) : (
          reviews.map((review) => (
            <Card key={review.id}>
              <CardBody>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink-900">{review.provider?.name}</p>
                    <p className="mt-0.5 text-sm text-ink-500">
                      {review.categoryName} · {formatDate(review.createdAt)}
                    </p>
                  </div>
                  <StarRating value={review.rating} size="sm" />
                </div>

                {review.title && <p className="mt-2 font-medium text-ink-800">{review.title}</p>}
                {review.comment && <p className="mt-1 text-base text-ink-600">{review.comment}</p>}

                {review.reply && (
                  <div className="mt-3 rounded-field border-l-2 border-brand-300 bg-ink-50 px-3 py-2">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-700">
                      <MessageSquare aria-hidden="true" className="h-3.5 w-3.5" />
                      They replied
                    </p>
                    <p className="mt-1 text-sm text-ink-600">{review.reply.text}</p>
                  </div>
                )}
              </CardBody>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
