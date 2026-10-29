import { Link } from 'react-router-dom';
import { MapPin, CheckCircle2, Clock } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import Avatar from '../../components/ui/Avatar.jsx';
import Badge from '../../components/ui/Badge.jsx';
import StarRating from '../../components/ui/StarRating.jsx';
import { money, pluralise } from '../../lib/format.js';

/**
 * One search result.
 *
 * A provider with no ratings shows "New" rather than a zero-star display,
 * because an honest 0.0 reads as a bad provider rather than an unrated one.
 *
 * The card itself is not a link. One button is the only way out of it, which
 * means there is no ambiguity about what a click does and no invisible overlay
 * sitting between the reader and the text they are trying to select.
 */
export default function ProviderCard({ provider }) {
  // Deliberately not `interactive`: that prop is for a card the whole of which
  // is a link, and it sets cursor-pointer. With only the button clickable, a
  // hand cursor over the card would promise something that does not happen.
  // The glow stays - it is ambient, not an affordance.
  return (
    <Card glow className="group h-full overflow-hidden">
      <div className="relative flex h-full flex-col p-4">
        {/* A corner wash that blooms on hover, behind everything and
            pointer-transparent so it cannot steal the click. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full
                     bg-brand-500/0 blur-2xl transition-colors duration-500 group-hover:bg-brand-500/20"
        />
        <div className="relative flex gap-3.5">
          {/* `self-start` so the wrapper is the size of the portrait and no
              more. A flex child stretches to the row by default, which put
              the tick level with the bottom of the whole card. */}
          <div className="relative shrink-0 self-start">
            <Avatar src={provider.avatarUrl} name={provider.name} size="lg" className="pro-avatar" />
            {provider.verifiedAt && (
              <span title="Verified professional" className="pro-verified">
                <CheckCircle2 aria-label="Verified professional" className="h-4 w-4" />
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="min-w-0">
              <h3 className="truncate font-display text-[0.9375rem] font-bold leading-snug
                             text-ink-900 transition-colors group-hover:text-brand-700">
                {provider.name}
              </h3>
              {provider.headline && (
                <p className="mt-1 line-clamp-2 text-sm leading-snug text-ink-500">
                  {provider.headline}
                </p>
              )}
            </div>

            <div className="pro-meta mt-2.5 flex flex-wrap items-center gap-y-1">
              {provider.rating.isNew ? (
                <Badge variant="info" size="sm">New</Badge>
              ) : (
                <StarRating value={provider.rating.average} size="sm" showValue count={provider.rating.count} />
              )}

              {/* Shown at zero too.
                  Hiding it left a new provider's card with a gap where every
                  other card has a figure, which reads as missing information
                  rather than as a provider who has not started. "0 jobs done"
                  beside the New badge says the same thing and says it
                  plainly. */}
              <span className="text-sm text-ink-500">
                {pluralise(provider.jobsCompleted ?? 0, 'job')} done
              </span>

              {provider.experienceYears > 0 && (
                <span className="text-sm text-ink-500">
                  {pluralise(provider.experienceYears, 'yr')} experience
                </span>
              )}
            </div>

            <div className="pro-meta mt-1.5 flex flex-wrap items-center gap-y-1 text-sm text-ink-500">
              {provider.distanceKm !== null && provider.distanceKm !== undefined && (
                <span className="flex items-center gap-1">
                  <MapPin aria-hidden="true" className="h-3.5 w-3.5" />
                  {provider.distanceKm} km away
                </span>
              )}
              {provider.avgResponseMinutes && (
                <span className="flex items-center gap-1">
                  <Clock aria-hidden="true" className="h-3.5 w-3.5" />
                  Usually replies in {provider.avgResponseMinutes} min
                </span>
              )}
            </div>

            {provider.categories?.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {provider.categories.slice(0, 3).map((category) => (
                  <span
                    key={category}
                    className="pro-tag"
                  >
                    {category}
                  </span>
                ))}
                {provider.categories.length > 3 && (
                  <span className="pro-tag">
                    +{provider.categories.length - 3}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="card-foot pro-foot relative flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="pro-price-label">Starting from</span>
            <span className="stat-accent text-xl leading-tight">{money(provider.fromPrice)}</span>
          </div>

          {/*
            Opens the profile rather than the slot picker.

            Booking from here would commit the customer to a provider before
            they have seen the services, the prices or the reviews - the
            profile is where that decision is actually made, and the booking
            action lives there.

            The name is still announced, because "Book now" four times over is
            useless to anyone listing the links on the page - but the label
            starts with the visible text. Someone driving the page by voice
            says what they can see, and a label that does not contain "Book
            now" would not match it.
          */}
          <Button
            as={Link}
            to={'/providers/' + provider.id}
            size="sm"
            variant="accent"
            aria-label={'Book now with ' + provider.name}
            /* No transition utility here: the button already transitions
               background-position, and naming only transform would stop the
               gradient sliding on hover. */
            className="shrink-0 whitespace-nowrap group-hover:-translate-y-0.5"
          >
            Book now
          </Button>
        </div>
      </div>
    </Card>
  );
}
