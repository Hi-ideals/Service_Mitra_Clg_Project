import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { useToastState } from '../../context/ToastContext.jsx';

const VARIANTS = {
  success: {
    icon: CheckCircle2,
    className: 'ring-success-500/25 bg-success-50/95 text-success-700',
    chip: 'icon-chip-success',
  },
  error: {
    icon: AlertCircle,
    className: 'ring-danger-500/25 bg-danger-50/95 text-danger-700',
    chip: 'icon-chip-danger',
  },
  info: {
    icon: Info,
    className: 'ring-info-500/25 bg-info-50/95 text-info-700',
    chip: 'icon-chip-info',
  },
};

export default function Toaster() {
  const { toasts, dismiss } = useToastState();

  if (!toasts.length) return null;

  return createPortal(
    <div
      // Polite rather than assertive: a confirmation should not interrupt what
      // a screen reader is already saying.
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 px-4 pb-24 sm:bottom-auto sm:right-0 sm:top-0 sm:items-end sm:p-4"
    >
      {toasts.map((toast) => {
        const variant = VARIANTS[toast.variant] ?? VARIANTS.info;
        const Icon = variant.icon;

        return (
          <div
            key={toast.id}
            className={clsx(
              // A toast floats above everything, so it needs more elevation
              // than a card that sits on the page.
              'pointer-events-auto flex w-full max-w-sm items-start gap-3',
              'rounded-card px-4 py-3 shadow-pop ring-1 ring-inset backdrop-blur-xl',
              // On a phone it rises from the bottom where it appears; on
              // desktop it slides in from the right edge it is pinned to.
              'animate-slide-up sm:animate-slide-in-right',
              variant.className,
            )}
          >
            <span className={clsx('icon-chip h-7 w-7', variant.chip)}>
              <Icon aria-hidden="true" className="h-4 w-4" />
            </span>
            <p className="min-w-0 flex-1 pt-1 text-base font-medium">{toast.message}</p>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss"
              className="-mr-1.5 -mt-0.5 shrink-0 rounded-field p-1.5 opacity-60 transition-opacity hover:bg-white/60 hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
