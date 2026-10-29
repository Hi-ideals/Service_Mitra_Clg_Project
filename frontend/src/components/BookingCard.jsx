import { Link } from 'react-router-dom';
import { Calendar, MapPin } from 'lucide-react';
import Card from './ui/Card.jsx';
import Badge, { BOOKING_STATUS_VARIANT } from './ui/Badge.jsx';
import Avatar from './ui/Avatar.jsx';
import { money, formatDateTime, relativeDay } from '../lib/format.js';

/**
 * One row in a booking list.
 *
 * Shared by the customer list and the provider list; `perspective` decides
 * which party is named, since a customer cares who is coming and a provider
 * cares who they are visiting.
 */
export default function BookingCard({ booking, perspective = 'customer', to }) {
  const other = perspective === 'customer' ? booking.provider : booking.customer;

  // Only a job genuinely under way gets the pulsing dot. Everything else
  // gets a static one, so the halo keeps meaning "right now".
  const live = booking.status === 'in_progress';

  // `services` is absent on anything served by an older client cache, so this
  // falls back to the single headline category rather than rendering "+NaN".
  const extraServices = Math.max(0, (booking.services?.length ?? 1) - 1);

  return (
    <Card interactive>
      <Link to={to || '/bookings/' + booking.id} className="group block p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <Avatar src={other?.avatarUrl} name={other?.name} size="md" />
            <div className="min-w-0">
              {/* One line, however many services. A row in a list has room
                  for a name and a count, not a list within a list. */}
              <p className="truncate font-semibold text-ink-900 transition-colors group-hover:text-brand-700">
                {booking.category.name}
                {extraServices > 0 && (
                  <span className="font-normal text-ink-500"> +{extraServices} more</span>
                )}
              </p>
              <p className="mt-0.5 truncate text-sm text-ink-500">
                {perspective === 'customer' ? 'with ' : 'for '}
                {other?.name}
              </p>
            </div>
          </div>

          <Badge variant={BOOKING_STATUS_VARIANT[booking.status]} size="sm" dot pulse={live}>
            {booking.statusLabel}
          </Badge>
        </div>

        <div className="mt-3 space-y-1.5 border-t border-ink-200/80 pt-3 text-sm text-ink-500">
          <p className="flex items-center gap-1.5">
            <Calendar aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            <span className="font-medium text-ink-700">{relativeDay(booking.schedule.start)}</span>
            <span>· {formatDateTime(booking.schedule.start)}</span>
          </p>
          <p className="flex items-center gap-1.5">
            <MapPin aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{booking.address.line}, {booking.address.pincode}</span>
          </p>
        </div>

        <div className="mt-3 flex items-baseline justify-between">
          <span className="rounded bg-ink-50 px-1.5 py-0.5 font-mono text-xs text-ink-400 ring-1 ring-inset ring-ink-200/70">
            {booking.reference}
          </span>
          <span className="figure text-lg">
            {money(booking.pricing.final ?? booking.pricing.quoted)}
          </span>
        </div>
      </Link>
    </Card>
  );
}
