import clsx from 'clsx';

/**
 * The surface everything sits on.
 *
 * `interactive` is for a card the whole of which is a link or a button.
 * `glow` is for the one card on a screen that should pull the eye - use it
 * twice and neither wins.
 * `accent` draws a brand hairline along the top edge, which marks a card as
 * the primary one without changing its weight.
 */
export function Card({
  as: Component = 'div',
  interactive = false,
  glow = false,
  accent = false,
  className,
  children,
  ...props
}) {
  return (
    <Component
      className={clsx(
        // A ring rather than a border: it sits on the same pixel as the
        // shadow's contact edge, so the card reads as one object instead of
        // an outline with a shadow behind it.
        'relative rounded-card bg-white shadow-card ring-1 ring-ink-200/80',
        accent && 'overflow-hidden before:absolute before:inset-x-0 before:top-0 before:h-0.5 ' +
          'before:bg-brand-gradient before:content-[""]',
        interactive && 'cursor-pointer focus-within:shadow-card-hover',
        interactive && (glow ? 'card-glow' : 'lift hover:ring-ink-300'),
        !interactive && glow && 'card-glow',
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  );
}

export function CardHeader({ title, subtitle, action, icon: Icon, className, children }) {
  return (
    <div
      className={clsx(
        'flex items-start justify-between gap-3 border-b border-ink-200/80 px-4 py-3.5 sm:px-5',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="icon-chip icon-chip-brand mt-0.5 h-8 w-8">
            <Icon aria-hidden="true" className="h-[1.125rem] w-[1.125rem]" />
          </span>
        )}
        <div className="min-w-0">
          {title && <h3 className="truncate text-md font-semibold text-ink-900">{title}</h3>}
          {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
          {children}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ className, children }) {
  return <div className={clsx('px-4 py-4 sm:px-5', className)}>{children}</div>;
}

export function CardFooter({ className, children }) {
  return (
    <div
      className={clsx(
        'rounded-b-card border-t border-ink-200/80 bg-gradient-to-b from-ink-50/70 to-ink-50 px-4 py-3 sm:px-5',
        className,
      )}
    >
      {children}
    </div>
  );
}

export default Card;
