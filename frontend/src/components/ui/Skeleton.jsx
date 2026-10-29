import clsx from 'clsx';

/**
 * A loading placeholder shaped like the content it replaces.
 *
 * Shaped placeholders rather than a spinner, because the page does not jump
 * when the real content arrives - and on a slow connection that jump is the
 * thing that makes an app feel broken.
 */
export default function Skeleton({ className, ...props }) {
  return <div aria-hidden="true" className={clsx('skeleton', className)} {...props} />;
}

export function SkeletonText({ lines = 3, className }) {
  return (
    <div className={clsx('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={clsx('h-3.5', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-card bg-white p-4 shadow-card ring-1 ring-ink-200/80">
      <div className="flex gap-3">
        <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
    </div>
  );
}

/**
 * The placeholder for a grid of provider cards.
 *
 * Matched to the real card's proportions - a placeholder that is the wrong
 * shape causes exactly the reflow it exists to prevent.
 */
export function SkeletonGrid({ count = 6, className }) {
  return (
    <div className={clsx('grid gap-4 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-card bg-white p-4 shadow-card ring-1 ring-ink-200/80">
          <div className="flex gap-3">
            <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
          <div className="mt-4 flex items-center justify-between">
            <Skeleton className="h-6 w-20 rounded-pill" />
            <Skeleton className="h-5 w-14" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Rows for a table or list that is still loading. */
export function SkeletonRows({ count = 5, className }) {
  return (
    <ul className={clsx('divide-y divide-ink-200', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-6 w-16 shrink-0 rounded-pill" />
        </li>
      ))}
    </ul>
  );
}
