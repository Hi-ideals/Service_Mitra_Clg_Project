import clsx from 'clsx';
import { initials as toInitials } from '../../lib/format.js';

const SIZES = {
  xs: 'h-7 w-7 text-[0.6875rem]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-lg',
  xl: 'h-20 w-20 text-2xl',
};

/**
 * Deterministic colour per person.
 *
 * Every avatar in the brand colour makes a list of people look like a list of
 * buttons - nothing distinguishes one row from the next at a glance. Hashing
 * the name into a fixed palette gives each person a stable identity colour
 * that survives reordering and refetching, which an index-based colour would
 * not.
 */
const PALETTE = [
  'from-brand-100 to-brand-200 text-brand-700 ring-brand-600/10',
  'from-info-50 to-info-100 text-info-700 ring-info-500/15',
  'from-accent-50 to-accent-100 text-accent-600 ring-accent-500/15',
  'from-success-50 to-success-100 text-success-700 ring-success-500/15',
  'from-ink-100 to-ink-200 text-ink-700 ring-ink-900/10',
  'from-danger-50 to-danger-100 text-danger-700 ring-danger-500/15',
];

function toneFor(name) {
  const text = String(name || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    // Bit-shift accumulator rather than a sum of char codes, so "Anil Kumar"
    // and "Kumar Anil" do not collide.
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export default function Avatar({ src, name, size = 'md', ring = false, className }) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        className={clsx(
          'shrink-0 rounded-full bg-ink-100 object-cover ring-1 ring-inset ring-ink-900/5',
          ring && 'ring-2 ring-white ring-offset-2 ring-offset-brand-100',
          SIZES[size],
          className,
        )}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={clsx(
        'flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-display font-semibold',
        'ring-1 ring-inset shadow-inset-top',
        toneFor(name),
        ring && 'ring-2 ring-white ring-offset-2 ring-offset-brand-100',
        SIZES[size],
        className,
      )}
    >
      {toInitials(name)}
    </span>
  );
}
