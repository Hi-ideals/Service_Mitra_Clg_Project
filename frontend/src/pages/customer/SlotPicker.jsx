import { useState } from 'react';
import clsx from 'clsx';
import { CalendarOff } from 'lucide-react';
import { relativeDay, formatDate, formatTime } from '../../lib/format.js';

/**
 * Date strip plus a grid of times.
 *
 * The slots come from the API already filtered - past times, committed
 * bookings and blocked dates are gone before they reach here. This component
 * only renders what is genuinely bookable, so nothing offered can be refused.
 */
export default function SlotPicker({ availability, value, onChange, loading = false }) {
  const days = availability || [];
  const firstBookable = days.findIndex((day) => !day.blocked && day.slots.length > 0);
  const [activeIndex, setActiveIndex] = useState(firstBookable === -1 ? 0 : firstBookable);

  const activeDay = days[activeIndex];

  if (!days.length) {
    return (
      <div className="panel-tint p-6 text-center">
        <span className="icon-chip icon-chip-neutral mx-auto h-10 w-10">
          <CalendarOff aria-hidden="true" className="h-5 w-5" />
        </span>
        <p className="mt-3 text-base text-ink-600">No availability published for this professional.</p>
      </div>
    );
  }

  return (
    // Dimmed, not replaced, while the grid is rebuilt for a different visit
    // length: swapping in a spinner would collapse the layout and lose the
    // user's place in a horizontally scrolled strip of dates.
    <div
      className={clsx('transition-opacity duration-200', loading && 'pointer-events-none opacity-50')}
      aria-busy={loading || undefined}
    >
      <div
        role="tablist"
        aria-label="Choose a date"
        className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-2 pt-1 sm:mx-0 sm:px-0"
      >
        {days.map((day, index) => {
          const unavailable = day.blocked || day.slots.length === 0;
          const active = index === activeIndex;

          return (
            <button
              key={day.date}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={unavailable}
              onClick={() => setActiveIndex(index)}
              className={clsx(
                'w-[4.75rem] shrink-0 rounded-card p-2.5 text-center ring-1 ring-inset',
                'transition-[background-color,box-shadow,transform] duration-200 ease-out',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
                active && 'bg-gradient-to-b from-brand-50 to-white shadow-card ring-2 ring-brand-600',
                !active && !unavailable &&
                  'bg-white shadow-xs ring-ink-200 hover:-translate-y-0.5 hover:shadow-card hover:ring-brand-200',
                // A day with nothing free is dimmed rather than hidden, so the
                // strip keeps its shape and the gaps stay legible as gaps.
                unavailable && 'cursor-not-allowed bg-ink-50 opacity-60 ring-ink-200',
              )}
            >
              <span className="block text-xs text-ink-500">{relativeDay(day.date)}</span>
              <span className={clsx('mt-0.5 block text-sm font-semibold', active ? 'text-brand-700' : 'text-ink-900')}>
                {formatDate(day.date, { short: true })}
              </span>
              <span
                className={clsx(
                  'mt-0.5 block text-xs',
                  active ? 'font-medium text-brand-600' : 'text-ink-500',
                )}
              >
                {day.blocked ? 'Closed' : day.slots.length ? day.slots.length + ' slots' : 'Full'}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4">
        {activeDay?.blocked ? (
          <p className="panel-tint p-4 text-base text-ink-600">
            Not working on this date{activeDay.reason ? ' (' + activeDay.reason + ')' : ''}.
          </p>
        ) : activeDay?.slots.length ? (
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink-700">
              Choose a time on {formatDate(activeDay.date)}
            </legend>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {activeDay.slots.map((slot) => {
                const selected = value === slot.start;
                return (
                  <label
                    key={slot.start}
                    className={clsx(
                      'cursor-pointer rounded-field px-2 py-2.5 text-center text-sm font-medium ring-1 ring-inset',
                      'transition-[background-color,box-shadow,transform,color] duration-200 ease-out',
                      'focus-within:ring-2 focus-within:ring-brand-600',
                      selected
                        ? 'bg-brand-gradient text-white shadow-glow-brand ring-brand-700'
                        : 'bg-white text-ink-700 shadow-xs ring-ink-200 hover:-translate-y-0.5 ' +
                          'hover:bg-brand-50 hover:text-brand-700 hover:shadow-card hover:ring-brand-200',
                    )}
                  >
                    <input
                      type="radio"
                      name="slot"
                      value={slot.start}
                      checked={selected}
                      onChange={() => onChange(slot.start)}
                      className="sr-only"
                    />
                    {formatTime(slot.start)}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : (
          <p className="panel-tint p-4 text-base text-ink-600">
            Fully booked on this date. Try another day.
          </p>
        )}
      </div>
    </div>
  );
}
