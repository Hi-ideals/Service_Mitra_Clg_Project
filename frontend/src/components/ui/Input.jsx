import { forwardRef, useId, useState } from 'react';
import clsx from 'clsx';
import { Eye, EyeOff } from 'lucide-react';

/**
 * A labelled field.
 *
 * The error is wired to the input with aria-describedby and aria-invalid, so
 * a screen reader announces the problem rather than the user discovering it
 * by submitting again.
 */
const Input = forwardRef(function Input(
  {
    label,
    error,
    hint,
    icon: Icon,
    suffix,
    className,
    containerClassName,
    required,
    type = 'text',
    revealable = false,
    id: providedId,
    ...props
  },
  ref,
) {
  const [revealed, setRevealed] = useState(false);

  // Opt-in, and only ever on a password. A reveal toggle on an ordinary field
  // would be a button that does nothing.
  const canReveal = revealable && type === 'password';

  const generatedId = useId();
  const id = providedId || generatedId;
  const errorId = id + '-error';
  const hintId = id + '-hint';

  return (
    <div className={clsx('w-full', containerClassName)}>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink-700">
          {label}
          {required && <span className="ml-0.5 text-danger-600" aria-hidden="true">*</span>}
        </label>
      )}

      {/* `group` so the icon can respond to the input's focus. A field whose
          icon lights up with it reads as one control rather than a glyph
          parked next to a box. */}
      <div className="group relative">
        {Icon && (
          <Icon
            aria-hidden="true"
            className={clsx(
              'pointer-events-none absolute left-3 top-1/2 h-[1.125rem] w-[1.125rem] -translate-y-1/2',
              'transition-colors duration-200',
              error ? 'text-danger-500' : 'text-ink-400 group-focus-within:text-brand-600',
            )}
          />
        )}

        <input
          ref={ref}
          id={id}
          type={canReveal && revealed ? 'text' : type}
          required={required}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={clsx(error && errorId, hint && !error && hintId) || undefined}
          className={clsx(
            'h-11 w-full rounded-field border bg-white px-3 text-base text-ink-800',
            'shadow-xs transition-[border-color,box-shadow,background-color] duration-200 ease-out',
            'placeholder:text-ink-400 hover:border-ink-400 hover:shadow-card',
            'focus:outline-none focus:ring-4 focus:ring-offset-0 focus:shadow-card',
            Icon && 'pl-10',
            (suffix || canReveal) && 'pr-12',
            error
              ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500/15'
              : 'border-ink-300 focus:border-brand-600 focus:ring-brand-600/15',
            'disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-500',
            className,
          )}
          {...props}
        />

        {suffix && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-500">{suffix}</div>
        )}

        {canReveal && (
          <button
            // type="button" matters: inside a form, a button without it
            // submits, so showing the password would send it.
            type="button"
            onClick={() => setRevealed((shown) => !shown)}
            // Not reachable by Tab. Someone moving through the form with the
            // keyboard is going from password to submit, and a stop in
            // between is a stop they did not ask for. Still clickable, and
            // still announced where it sits.
            tabIndex={-1}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            aria-pressed={revealed}
            className={clsx(
              'absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center',
              'rounded-field text-ink-400 transition-colors duration-200',
              'hover:bg-ink-100 hover:text-ink-700',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/40',
            )}
          >
            {revealed
              ? <EyeOff aria-hidden="true" className="h-[1.125rem] w-[1.125rem]" />
              : <Eye aria-hidden="true" className="h-[1.125rem] w-[1.125rem]" />}
          </button>
        )}
      </div>

      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-sm text-danger-600">
          {error}
        </p>
      )}

      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-sm text-ink-500">
          {hint}
        </p>
      )}
    </div>
  );
});

export default Input;
