import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Button from './Button.jsx';

export default function Pagination({ page, totalPages, total, onChange, className }) {
  if (!totalPages || totalPages <= 1) return null;

  // A window around the current page, so 200 pages do not render 200 buttons.
  const window = 1;
  const pages = [];
  for (let i = 1; i <= totalPages; i += 1) {
    const near = Math.abs(i - page) <= window;
    if (i === 1 || i === totalPages || near) pages.push(i);
    else if (pages[pages.length - 1] !== '...') pages.push('...');
  }

  return (
    <nav aria-label="Pagination" className={clsx('flex items-center justify-between gap-3', className)}>
      <p className="hidden text-sm text-ink-500 sm:block">
        Page {page} of {totalPages}
        {total !== undefined && ' · ' + total + ' results'}
      </p>

      <div className="flex flex-1 items-center justify-center gap-1 sm:flex-none sm:justify-end">
        <Button
          variant="secondary"
          size="sm"
          icon={ChevronLeft}
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          aria-label="Previous page"
        />

        {pages.map((p, index) =>
          p === '...' ? (
            <span key={'gap' + index} className="px-1 text-sm text-ink-400" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              aria-current={p === page ? 'page' : undefined}
              className={clsx(
                'h-8 min-w-8 rounded-field px-2 text-sm font-medium tabular-nums',
                'transition-[background-color,box-shadow,color] duration-200',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2',
                p === page
                  ? 'bg-brand-gradient text-white shadow-glow-brand'
                  : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
              )}
            >
              {p}
            </button>
          ),
        )}

        <Button
          variant="secondary"
          size="sm"
          icon={ChevronRight}
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          aria-label="Next page"
        />
      </div>
    </nav>
  );
}
