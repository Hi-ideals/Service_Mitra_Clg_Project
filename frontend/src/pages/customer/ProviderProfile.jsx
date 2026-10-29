import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2, MapPin, Languages, Briefcase, CalendarDays, MessageSquare, UserX,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { keys } from '../../lib/queryClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import Card, { CardBody, CardHeader } from '../../components/ui/Card.jsx';
import Avatar from '../../components/ui/Avatar.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import StarRating from '../../components/ui/StarRating.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { money, duration, formatDate, relativeDay, pluralise } from '../../lib/format.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';

function RatingBreakdown({ summary }) {
  if (!summary || summary.count === 0) return null;

  return (
    <div className="space-y-1.5">
      {[5, 4, 3, 2, 1].map((stars) => {
        const bucket = summary.distribution[String(stars)] || { count: 0, percent: 0 };
        return (
          <div key={stars} className="flex items-center gap-2">
            <span className="w-3 text-xs tabular-nums text-ink-500">{stars}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
              <div className="h-full rounded-full bg-accent-400" style={{ width: bucket.percent + '%' }} />
            </div>
            <span className="w-8 text-right text-xs tabular-nums text-ink-500">{bucket.count}</span>
          </div>
        );
      })}
    </div>
  );
}

function AvailabilityStrip({ availability }) {
  const bookable = (availability || []).filter((day) => !day.blocked && day.slots.length > 0);

  if (!bookable.length) {
    return (
      <p className="text-base text-ink-500">
        No slots open in the next week. Try again later, or look at another professional.
      </p>
    );
  }

  return (
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      {bookable.slice(0, 7).map((day) => (
        <div
          key={day.date}
          className="w-28 shrink-0 panel-tint p-3 text-center"
        >
          <p className="text-sm font-semibold text-ink-900">{relativeDay(day.date)}</p>
          <p className="mt-0.5 text-xs text-ink-500">{formatDate(day.date, { short: true })}</p>
          <p className="mt-2 text-sm font-medium text-brand-700">
            {pluralise(day.slots.length, 'slot')}
          </p>
        </div>
      ))}
    </div>
  );
}

export default function ProviderProfile() {
  useDocumentTitle('Provider profile');
  const { id } = useParams();
  const { isCustomer, isAuthenticated } = useAuth();

  const { data: provider, isLoading, error } = useQuery({
    queryKey: keys.providers.profile(id),
    queryFn: async () => (await api.get('/providers/' + id, { params: { days: 7 } })).data,
    retry: false,
  });

  const { data: reviews } = useQuery({
    queryKey: keys.providers.reviews(id, { limit: 5 }),
    queryFn: () => api.get('/providers/' + id + '/reviews', { params: { limit: 5 } }),
    enabled: Boolean(id),
  });

  const { data: summary } = useQuery({
    queryKey: [...keys.providers.reviews(id, {}), 'summary'],
    queryFn: async () => (await api.get('/providers/' + id + '/reviews/summary')).data,
    enabled: Boolean(id),
  });

  if (isLoading) {
    return (
      <div className="page max-w-5xl py-6">
        <Skeleton className="h-32 w-full rounded-card" />
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-2">
            <Skeleton className="h-40 w-full rounded-card" />
            <Skeleton className="h-52 w-full rounded-card" />
          </div>
          <Skeleton className="h-64 w-full rounded-card" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page py-10">
        <EmptyState
          icon={UserX}
          title="This professional is not available"
          description="They may have gone offline, or the link may be out of date."
          action={<Button as={Link} to="/search">Find another professional</Button>}
        />
      </div>
    );
  }

  const bookHref = isAuthenticated ? '/book/' + provider.id : '/signin';

  return (
    <div className="page max-w-5xl py-5 sm:py-7">
      <Card>
        <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Avatar src={provider.avatarUrl} name={provider.name} size="xl" />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-ink-900">{provider.name}</h1>
              {provider.isVerified && (
                <Badge variant="success" size="sm">
                  <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
                  Verified
                </Badge>
              )}
            </div>

            {provider.headline && <p className="mt-1 text-md text-ink-600">{provider.headline}</p>}

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              {provider.rating.isNew ? (
                <Badge variant="info" size="sm">New on ServiceMitra</Badge>
              ) : (
                <StarRating value={provider.rating.average} showValue count={provider.rating.count} />
              )}

              <span className="flex items-center gap-1.5 text-sm text-ink-500">
                <Briefcase aria-hidden="true" className="h-4 w-4" />
                {pluralise(provider.jobsCompleted, 'job')} completed
              </span>

              {provider.experienceYears > 0 && (
                <span className="text-sm text-ink-500">
                  {pluralise(provider.experienceYears, 'year')} experience
                </span>
              )}
            </div>
          </div>

          <div className="shrink-0">
            {isAuthenticated && !isCustomer ? (
              <p className="text-sm text-ink-500">Sign in as a customer to book.</p>
            ) : (
              <Button as={Link} to={bookHref} size="lg" icon={CalendarDays} fullWidth>
                Book this professional
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      {/*
        `min-w-0` on both columns is load-bearing, not tidying.

        A grid item's automatic minimum size is its min-content width, so a
        column refuses to shrink below the widest thing inside it. The day
        strip under "Next available" scrolls sideways, and its min-content is
        the full row of day cards - around 744px. That stretched the single
        mobile track to 744px inside a 343px container, and the page ran off
        the right edge: text clipped mid-word, the "Pick a slot" button cut in
        half. The strip's own `overflow-x-auto` cannot prevent it, because it
        is this column being measured, not the strip.
      */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Services and prices" subtitle="Agreed before you book." />
            <CardBody className="divide-y divide-ink-200">
              {provider.services.map((service) => (
                <div
                  key={service.categoryId}
                  className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-ink-900">{service.categoryName}</p>
                    <p className="mt-0.5 text-sm text-ink-500">
                      About {duration(service.estimatedMinutes)}
                    </p>
                  </div>
                  <p className="shrink-0 text-lg font-semibold text-ink-900">{money(service.price)}</p>
                </div>
              ))}
            </CardBody>
          </Card>

          {provider.bio && (
            <Card>
              <CardHeader title="About" />
              <CardBody>
                <p className="whitespace-pre-line text-base text-ink-600">{provider.bio}</p>

                {provider.skills?.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {provider.skills.map((skill) => (
                      <span key={skill} className="rounded-full bg-ink-100 px-2.5 py-1 text-sm text-ink-600">
                        {skill}
                      </span>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title={'Reviews' + (summary?.count ? ' (' + summary.count + ')' : '')} />
            <CardBody>
              {summary?.count > 0 && (
                <div className="mb-5 flex flex-col gap-5 sm:flex-row sm:items-center">
                  <div className="text-center sm:w-32">
                    <p className="text-4xl font-bold text-ink-900">{summary.average.toFixed(1)}</p>
                    <StarRating value={summary.average} className="mt-1 justify-center" />
                    <p className="mt-1 text-sm text-ink-500">{pluralise(summary.count, 'review')}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <RatingBreakdown summary={summary} />
                  </div>
                </div>
              )}

              {reviews?.data?.length > 0 ? (
                <ul className="divide-y divide-ink-200">
                  {reviews.data.map((review) => (
                    <li key={review.id} className="py-4 first:pt-0 last:pb-0">
                      <div className="flex items-start gap-3">
                        <Avatar src={review.customer?.avatarUrl} name={review.customer?.name} size="sm" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <p className="font-medium text-ink-900">{review.customer?.name}</p>
                            <span className="text-xs text-ink-400">{formatDate(review.createdAt)}</span>
                          </div>
                          <StarRating value={review.rating} size="sm" className="mt-1" />
                          {review.title && <p className="mt-1.5 font-medium text-ink-800">{review.title}</p>}
                          {review.comment && <p className="mt-1 text-base text-ink-600">{review.comment}</p>}

                          {review.reply && (
                            <div className="mt-3 rounded-field border-l-2 border-brand-300 bg-ink-50 px-3 py-2">
                              <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-700">
                                <MessageSquare aria-hidden="true" className="h-3.5 w-3.5" />
                                Reply from {provider.name}
                              </p>
                              <p className="mt-1 text-sm text-ink-600">{review.reply.text}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-base text-ink-500">
                  Not reviewed yet. Reviews can only be left by customers whose booking was
                  actually completed.
                </p>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Next available" />
            <CardBody>
              <AvailabilityStrip availability={provider.availability} />
              {provider.nextAvailableSlot && (
                <Button as={Link} to={bookHref} fullWidth className="mt-4">
                  Pick a slot
                </Button>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Where they work" />
            <CardBody className="space-y-3">
              {provider.serviceAreas.map((area, index) => (
                <div key={index} className="flex gap-2">
                  <MapPin aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                  <div className="min-w-0">
                    <p className="font-medium text-ink-900">
                      {area.city}, {area.state}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-500">Within {area.radiusKm} km</p>
                  </div>
                </div>
              ))}

              {provider.languages?.length > 0 && (
                <div className="flex gap-2 border-t border-ink-200 pt-3">
                  <Languages aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                  <p className="text-base text-ink-600">{provider.languages.join(', ')}</p>
                </div>
              )}
            </CardBody>
          </Card>

          <p className="px-1 text-xs text-ink-400">
            Contact details are shared once the professional accepts your booking.
          </p>
        </div>
      </div>
    </div>
  );
}
