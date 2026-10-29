import clsx from 'clsx';
import { Inbox } from 'lucide-react';

/**
 * What a list shows when it has nothing in it.
 *
 * Always says what to do next rather than only stating the absence - "No
 * bookings yet" is a dead end, "Book your first service" is a door.
 */
export default function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
  compact = false,
}) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center text-center',
        compact ? 'px-4 py-8' : 'px-4 py-14',
        className,
      )}
    >
      {/* The icon sits on its own pool of light.
          A grey disc on a white card is the visual equivalent of a shrug; a
          soft radial behind a ringed tile gives the empty state a focal point,
          so the screen still looks finished rather than unfinished. */}
      <div className="relative mb-5">
        <span
          aria-hidden="true"
          className="absolute -inset-5 rounded-full bg-brand-500/10 blur-xl"
        />
        <div
          className={clsx(
            'relative flex items-center justify-center rounded-card',
            'bg-gradient-to-b from-white to-ink-100 ring-1 ring-inset ring-ink-200 shadow-card',
            compact ? 'h-12 w-12' : 'h-16 w-16',
          )}
        >
          <Icon
            aria-hidden="true"
            className={clsx('text-brand-600/80', compact ? 'h-5 w-5' : 'h-7 w-7')}
          />
        </div>
      </div>

      <h3 className="text-md font-semibold text-ink-900">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-base text-ink-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
