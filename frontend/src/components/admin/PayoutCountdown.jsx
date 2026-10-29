import { useEffect, useState } from 'react';
import { Hourglass } from 'lucide-react';

/**
 * How long until held earnings become payable.
 *
 * Ticks every second. The wait is usually measured in hours, so the seconds
 * are not information an admin acts on - they are the signal that the number
 * is live rather than a timestamp rendered once and left to go stale.
 *
 * Each instance owns one interval. On a screen with a handful of providers
 * that is nothing; if this ever has to render hundreds of rows, a single timer
 * at the page level driving them all would be the change to make.
 *
 * Returns null once the moment passes, and tells the caller, which refetches -
 * so the row turns payable without a page reload.
 */
const pad = (n) => String(n).padStart(2, '0');

function remaining(until) {
  const ms = new Date(until).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return null;

  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  const clock = pad(hours) + ':' + pad(minutes) + ':' + pad(seconds);
  return days > 0 ? days + 'd ' + clock : clock;
}

export default function PayoutCountdown({ until, onElapsed, className }) {
  const [label, setLabel] = useState(() => remaining(until));

  useEffect(() => {
    setLabel(remaining(until));

    const id = setInterval(() => {
      const next = remaining(until);
      setLabel(next);
      if (next === null) {
        clearInterval(id);
        onElapsed?.();
      }
    }, 1000);

    return () => clearInterval(id);
    // `onElapsed` is deliberately not a dependency: a parent that rebuilds the
    // callback on every render would otherwise restart the timer each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [until]);

  if (!label) return null;

  return (
    <span
      className={
        'inline-flex items-center gap-1.5 rounded-pill bg-warning-50 px-2 py-0.5 text-xs ' +
        'font-medium text-warning-700 ring-1 ring-inset ring-warning-500/20 ' +
        (className ?? '')
      }
    >
      <Hourglass aria-hidden="true" className="h-3 w-3" />
      {/* Tabular figures, so the digits do not jiggle the row as they change. */}
      payable in <span className="tabular-nums">{label}</span>
    </span>
  );
}
