import clsx from 'clsx';
import { Check, Circle, XCircle } from 'lucide-react';
import { formatDateTime } from '../lib/format.js';

/**
 * The four-step progress spine, or a stopped timeline when the booking
 * branched off it.
 *
 * A cancelled booking does not render "in progress" as still upcoming, which
 * would suggest a technician is on the way.
 */
export default function BookingStatusTimeline({ steps, branchedTo, className }) {
  if (branchedTo) {
    return (
      <div className={clsx('panel-tint flex items-center gap-2.5 p-3.5', className)}>
        <span className="icon-chip icon-chip-neutral h-8 w-8">
          <XCircle aria-hidden="true" className="h-[1.125rem] w-[1.125rem]" />
        </span>
        <p className="text-base font-medium text-ink-700">
          This booking was {branchedTo === 'rejected' ? 'declined' : branchedTo}.
        </p>
      </div>
    );
  }

  return (
    <ol className={clsx('space-y-0', className)}>
      {steps.map((step, index) => {
        const last = index === steps.length - 1;

        return (
          <li key={step.status} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={clsx(
                  'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors',
                  step.reached && !step.current && 'bg-brand-gradient text-white shadow-btn',
                  // The current step carries a glow as well as a ring. On a
                  // long timeline the ring alone is easy to miss, and "where
                  // am I now" is the only question this component answers.
                  step.current && 'bg-white text-brand-700 shadow-glow-brand ring-2 ring-brand-600',
                  !step.reached && 'bg-ink-100 text-ink-300 ring-1 ring-inset ring-ink-200',
                )}
              >
                {step.reached && !step.current ? (
                  <Check aria-hidden="true" className="h-3.5 w-3.5" />
                ) : (
                  <Circle aria-hidden="true" className={clsx('h-2 w-2', step.current && 'fill-current')} />
                )}
              </span>
              {!last && (
                <span
                  aria-hidden="true"
                  className={clsx(
                    'w-0.5 flex-1 rounded-pill',
                    step.reached ? 'bg-gradient-to-b from-brand-600 to-brand-400' : 'bg-ink-200',
                  )}
                />
              )}
            </div>

            <div className={clsx('min-w-0 flex-1', last ? 'pb-0' : 'pb-5')}>
              <p
                className={clsx(
                  'text-base font-medium capitalize',
                  step.current ? 'text-brand-700' : step.reached ? 'text-ink-900' : 'text-ink-400',
                )}
              >
                {step.label}
              </p>
              {step.at && <p className="mt-0.5 text-sm text-ink-500">{formatDateTime(step.at)}</p>}
              {step.current && (
                <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600">
                  <span aria-hidden="true" className="live-dot" />
                  Happening now
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
