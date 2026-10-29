import clsx from 'clsx';

/**
 * The title block at the top of a page.
 *
 * Every page had its own `<h1>` plus a paragraph, and they had drifted - some
 * used `text-2xl`, some `text-xl`, some had no description at all. This fixes
 * the shape so a user moving between sections is not re-reading a differently
 * sized heading each time.
 */
export default function PageHeader({
  title,
  description,
  icon: Icon,
  action,
  eyebrow,
  className,
  children,
}) {
  return (
    <div className={clsx('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="icon-chip icon-chip-brand mt-0.5 h-10 w-10 shrink-0">
            <Icon aria-hidden="true" className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">{eyebrow}</p>
          )}
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{title}</h1>
          {description && <p className="mt-1 text-base text-ink-500">{description}</p>}
          {children}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
