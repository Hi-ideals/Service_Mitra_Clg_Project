import clsx from 'clsx';

/**
 * A gradient fill rather than a flat tint.
 *
 * At badge size the gradient is barely perceptible as a gradient - what it
 * does is stop a row of pills reading as flat stickers, and makes them match
 * the icon chips used elsewhere.
 */
const VARIANTS = {
  neutral: 'bg-gradient-to-b from-ink-50 to-ink-100 text-ink-700 ring-ink-200',
  brand: 'bg-gradient-to-b from-brand-50 to-brand-100 text-brand-700 ring-brand-200',
  success: 'bg-gradient-to-b from-success-50 to-success-100 text-success-700 ring-success-500/20',
  warning: 'bg-gradient-to-b from-warning-50 to-warning-100 text-warning-700 ring-warning-500/20',
  danger: 'bg-gradient-to-b from-danger-50 to-danger-100 text-danger-700 ring-danger-500/20',
  info: 'bg-gradient-to-b from-info-50 to-info-100 text-info-700 ring-info-500/20',
  /* For a count or a figure that should read as data, not as a status. */
  solid: 'bg-ink-800 text-white ring-ink-900/10',
};

/**
 * Maps a booking status to a colour once, here, so the customer list, the
 * provider list and the admin monitor cannot disagree about what "accepted"
 * looks like.
 */
export const BOOKING_STATUS_VARIANT = {
  requested: 'warning',
  accepted: 'info',
  in_progress: 'brand',
  completed: 'success',
  rejected: 'neutral',
  cancelled: 'neutral',
  disputed: 'danger',
  refunded: 'neutral',
};

export const VERIFICATION_VARIANT = {
  unsubmitted: 'neutral',
  pending: 'warning',
  info_requested: 'warning',
  approved: 'success',
  rejected: 'danger',
  suspended: 'danger',
};

export default function Badge({
  variant = 'neutral',
  size = 'md',
  dot = false,
  pulse = false,
  className,
  children,
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-pill font-medium ring-1 ring-inset shadow-inset-top',
        // Wider than it is tall, and never wrapping: a status that breaks
        // across two lines stops reading as a single token.
        'whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
        VARIANTS[variant] ?? VARIANTS.neutral,
        className,
      )}
    >
      {/* `pulse` is for a status that is genuinely happening right now - a job
          in progress, a provider online. On anything static the halo is a lie
          about activity. */}
      {dot &&
        (pulse ? (
          <span aria-hidden="true" className="live-dot" />
        ) : (
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
        ))}
      {children}
    </span>
  );
}
