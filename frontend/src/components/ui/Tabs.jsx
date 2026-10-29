import clsx from 'clsx';

/**
 * Filter tabs with counts.
 *
 * Horizontally scrollable on a phone rather than wrapping, so the row keeps
 * its shape and the selected tab stays where the user expects it. The inactive
 * pills are deliberately quiet - a row where every tab has a border and a
 * shadow reads as six competing buttons rather than one choice.
 */
export default function Tabs({ tabs, value, onChange, className }) {
  return (
    <div
      role="tablist"
      className={clsx(
        'no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0',
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={clsx(
              'group relative flex shrink-0 items-center gap-1.5 rounded-pill px-3.5 py-2 text-sm font-medium',
              'transition-[background-color,box-shadow,color,transform] duration-200 ease-out',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2',
              active
                ? 'bg-brand-gradient text-white shadow-glow-brand'
                : 'bg-white text-ink-600 shadow-xs ring-1 ring-inset ring-ink-200 ' +
                  'hover:-translate-y-px hover:bg-ink-50 hover:text-ink-900 hover:shadow-card hover:ring-ink-300',
            )}
          >
            {tab.label}
            {tab.count !== undefined && tab.count !== null && (
              <span
                className={clsx(
                  'rounded-full px-1.5 text-xs font-semibold tabular-nums transition-colors',
                  active ? 'bg-white/25 text-white' : 'bg-ink-100 text-ink-600 group-hover:bg-ink-200',
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
