import clsx from 'clsx';
import { AlertCircle, CheckCircle2, Info, AlertTriangle } from 'lucide-react';

const VARIANTS = {
  info: {
    icon: Info,
    className: 'bg-gradient-to-br from-info-50 to-white text-info-700 ring-info-500/20 before:bg-info-500',
  },
  success: {
    icon: CheckCircle2,
    className: 'bg-gradient-to-br from-success-50 to-white text-success-700 ring-success-500/20 before:bg-success-500',
  },
  warning: {
    icon: AlertTriangle,
    className: 'bg-gradient-to-br from-warning-50 to-white text-warning-700 ring-warning-500/20 before:bg-warning-500',
  },
  error: {
    icon: AlertCircle,
    className: 'bg-gradient-to-br from-danger-50 to-white text-danger-700 ring-danger-500/20 before:bg-danger-500',
  },
};

/**
 * An inline message attached to the thing it concerns.
 *
 * Errors a user must act on belong here, not in a toast that disappears
 * before they have finished reading it.
 */
export default function Alert({ variant = 'info', title, action, className, children }) {
  const { icon: Icon, className: variantClass } = VARIANTS[variant] ?? VARIANTS.info;

  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={clsx(
        // The coloured edge does the signalling, so the fill can stay pale
        // enough for the text on it to remain comfortably readable.
        'relative flex animate-rise-in gap-2.5 overflow-hidden rounded-card px-4 py-3 shadow-xs ring-1 ring-inset',
        'before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-[""]',
        variantClass,
        className,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 h-[1.125rem] w-[1.125rem] shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={clsx('text-base', title && 'mt-0.5 opacity-90')}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
