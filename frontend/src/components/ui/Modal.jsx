import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { X } from 'lucide-react';

/**
 * A dialog that becomes a bottom sheet on a phone.
 *
 * On a small screen a centred modal is awkward to reach one-handed, so it
 * slides up from the bottom instead. Above `sm` it is a conventional centred
 * dialog. Focus is trapped and Escape closes it, because a dialog you cannot
 * leave with the keyboard is a trap in the literal sense.
 */
export default function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  footer,
  children,
  closeOnBackdrop = true,
}) {
  const panelRef = useRef(null);
  const previouslyFocused = useRef(null);

  /**
   * onClose is held in a ref so the effect below does not depend on it.
   *
   * Callers pass an inline arrow - a new function identity on every render.
   * As an effect dependency that made the whole setup tear down and rebuild
   * on every keystroke inside the dialog: the cleanup restored focus to
   * whatever opened the modal, then the re-run moved focus to the panel, so
   * a text field lost focus after every character typed into it.
   */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocused.current = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        onCloseRef.current?.();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = panelRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    // Focus the panel so a screen reader announces the dialog immediately.
    requestAnimationFrame(() => panelRef.current?.focus());

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      previouslyFocused.current?.focus?.();
    };
    // Deliberately only `open`: see onCloseRef above.
  }, [open]);

  if (!open) return null;

  const widths = {
    sm: 'sm:max-w-sm',
    md: 'sm:max-w-lg',
    lg: 'sm:max-w-2xl',
    xl: 'sm:max-w-4xl',
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 animate-fade-in bg-ink-900/50 backdrop-blur-md"
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={clsx(
          'relative flex max-h-[92vh] w-full flex-col bg-white shadow-pop outline-none',
          // A hairline on the panel keeps its edge legible against a dark scrim.
          'ring-1 ring-ink-900/5',
          // A sheet rises; a centred dialog scales up from where it is. Using
          // the rise on desktop makes a dialog look like it fell out of the
          // bottom of the screen.
          'animate-slide-up sm:animate-scale-in',
          'rounded-t-2xl sm:rounded-card',
          widths[size],
        )}
      >
        {/* The grab handle reads as "this sheet can be dismissed". */}
        <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-ink-300 sm:hidden" />

        {(title || onClose) && (
          <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
            <div className="min-w-0">
              {title && <h2 className="text-lg font-semibold text-ink-900">{title}</h2>}
              {description && <p className="mt-1 text-sm text-ink-500">{description}</p>}
            </div>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-1.5 -mt-1 rounded-field p-1.5 text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-700"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>

        {footer && (
          <div className="shrink-0 border-t border-ink-200 bg-ink-50/60 px-5 py-3 pb-safe sm:pb-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
