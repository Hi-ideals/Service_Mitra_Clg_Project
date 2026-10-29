import clsx from 'clsx';
import { Loader2 } from 'lucide-react';

const SIZES = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-8 w-8' };

export default function Spinner({ size = 'md', label = 'Loading', className }) {
  return (
    <span role="status" className={clsx('inline-flex items-center gap-2 text-brand-600', className)}>
      <Loader2 aria-hidden="true" className={clsx('animate-spin', SIZES[size])} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * Fills a route while its page chunk or first query is loading.
 *
 * The label is visible rather than screen-reader-only here: on a full-page
 * wait, a lone spinner leaves the user guessing whether anything is happening,
 * and naming what is loading costs nothing.
 */
export function PageLoader({ label = 'Loading' }) {
  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center gap-4">
      <span className="relative flex h-12 w-12 items-center justify-center">
        {/* A soft pool of brand light behind the spinner, so the wait looks
            designed rather than like a stalled page. */}
        <span
          aria-hidden="true"
          className="absolute inset-0 animate-pulse rounded-full bg-brand-500/15 blur-lg"
        />
        <Loader2 aria-hidden="true" className="relative h-8 w-8 animate-spin text-brand-600" />
      </span>
      <p role="status" className="text-sm font-medium text-ink-500">
        {label}…
      </p>
    </div>
  );
}
