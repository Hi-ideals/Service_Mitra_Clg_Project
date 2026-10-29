import { Star } from 'lucide-react';
import clsx from 'clsx';

/**
 * Stars, either as a read-only display or as an input.
 *
 * As an input it is a radio group rather than a row of buttons, so it works
 * with the keyboard and announces "3 of 5 stars" to a screen reader.
 */
export default function StarRating({
  value = 0,
  onChange,
  size = 'md',
  showValue = false,
  count,
  name = 'rating',
  className,
}) {
  const dimensions = { sm: 'h-3.5 w-3.5', md: 'h-4 w-4', lg: 'h-7 w-7' }[size];
  const interactive = Boolean(onChange);

  if (!interactive) {
    return (
      <span className={clsx('inline-flex items-center gap-1', className)}>
        <span className="flex" aria-hidden="true">
          {[1, 2, 3, 4, 5].map((star) => (
            <Star
              key={star}
              className={clsx(
                dimensions,
                star <= Math.round(value) ? 'fill-accent-400 text-accent-400' : 'text-ink-300',
              )}
            />
          ))}
        </span>
        {showValue && <span className="text-sm font-medium text-ink-700">{Number(value).toFixed(1)}</span>}
        {count !== undefined && <span className="text-sm text-ink-500">({count})</span>}
        <span className="sr-only">
          {count === 0 ? 'No ratings yet' : Number(value).toFixed(1) + ' out of 5 stars'}
        </span>
      </span>
    );
  }

  return (
    <fieldset className={clsx('inline-flex items-center gap-1', className)}>
      <legend className="sr-only">Rating</legend>
      {[1, 2, 3, 4, 5].map((star) => (
        <label key={star} className="cursor-pointer p-0.5 focus-within:outline-none">
          <input
            type="radio"
            name={name}
            value={star}
            checked={value === star}
            onChange={() => onChange(star)}
            className="sr-only"
          />
          <Star
            className={clsx(
              dimensions,
              // Grows on hover and settles when chosen. Rating is one of the
              // few places a small flourish is warranted: it is a deliberate,
              // one-off act rather than routine navigation.
              'transition-[transform,color,fill] duration-150 ease-out hover:scale-125',
              star <= value
                ? 'scale-110 fill-accent-400 text-accent-400 drop-shadow-sm'
                : 'text-ink-300 hover:text-accent-300',
            )}
          />
          <span className="sr-only">{star} of 5 stars</span>
        </label>
      ))}
    </fieldset>
  );
}
