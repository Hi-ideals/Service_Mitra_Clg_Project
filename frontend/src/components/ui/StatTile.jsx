import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowRight } from 'lucide-react';

const TONES = {
  brand: 'icon-chip-brand',
  success: 'icon-chip-success',
  warning: 'icon-chip-warning',
  danger: 'icon-chip-danger',
  info: 'icon-chip-info',
  neutral: 'icon-chip-neutral',
};

/**
 * A single figure on a dashboard.
 *
 * Four separate dashboards each had their own version of this, which is how
 * the admin tiles and the provider tiles ended up with different type sizes
 * for the same kind of number. One component, so they cannot drift again.
 *
 * `to` turns the whole tile into a link - a figure a user wants to drill into
 * should be clickable across its whole area, not just on a small arrow.
 */
export default function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  tone = 'neutral',
  to,
  className,
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {Icon && (
            <span className={clsx('icon-chip h-9 w-9 shrink-0', TONES[tone] ?? TONES.neutral)}>
              <Icon aria-hidden="true" className="h-[1.125rem] w-[1.125rem]" />
            </span>
          )}
          {/* Wraps to a second line rather than truncating. A clipped label
              like "Available to withdr…" is worse than a taller tile, and the
              grid equalises the heights anyway. */}
          <p className="min-w-0 text-sm font-medium leading-tight text-ink-500">{label}</p>
        </div>
        {to && (
          <ArrowRight
            aria-hidden="true"
            className="mt-1 h-4 w-4 shrink-0 text-ink-300 transition-[transform,color] duration-200
                       group-hover:translate-x-0.5 group-hover:text-brand-600"
          />
        )}
      </div>

      <p className="figure mt-3 text-3xl">{value}</p>
      {sub && <p className="mt-auto pt-1 text-xs text-ink-400">{sub}</p>}
    </>
  );

  const shell = clsx(
    'group relative flex h-full flex-col overflow-hidden rounded-card bg-white p-4 shadow-card ring-1 ring-ink-200/80',
    to && 'lift cursor-pointer hover:ring-brand-200',
    className,
  );

  if (to) {
    return (
      <Link to={to} className={shell}>
        {body}
      </Link>
    );
  }

  return <div className={shell}>{body}</div>;
}
