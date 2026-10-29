import { forwardRef, useId } from 'react';
import clsx from 'clsx';

const Textarea = forwardRef(function Textarea(
  { label, error, hint, maxLength, value, className, containerClassName, required, id: providedId, ...props },
  ref,
) {
  const generatedId = useId();
  const id = providedId || generatedId;
  const errorId = id + '-error';
  const used = typeof value === 'string' ? value.length : 0;

  return (
    <div className={clsx('w-full', containerClassName)}>
      {label && (
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <label htmlFor={id} className="block text-sm font-medium text-ink-700">
            {label}
            {required && <span className="ml-0.5 text-danger-600" aria-hidden="true">*</span>}
          </label>
          {maxLength && (
            <span className={clsx('text-xs tabular-nums', used > maxLength * 0.9 ? 'text-warning-600' : 'text-ink-400')}>
              {used}/{maxLength}
            </span>
          )}
        </div>
      )}

      <textarea
        ref={ref}
        id={id}
        value={value}
        maxLength={maxLength}
        required={required}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? errorId : undefined}
        className={clsx(
          'w-full rounded-field border bg-white px-3 py-2.5 text-base text-ink-800',
          'shadow-xs transition-[border-color,box-shadow] duration-200 ease-out',
          'placeholder:text-ink-400 hover:border-ink-400 focus:outline-none focus:ring-4',
          error
            ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500/15'
            : 'border-ink-300 focus:border-brand-600 focus:ring-brand-600/15',
          className,
        )}
        {...props}
      />

      {error && <p id={errorId} role="alert" className="mt-1.5 text-sm text-danger-600">{error}</p>}
      {hint && !error && <p className="mt-1.5 text-sm text-ink-500">{hint}</p>}
    </div>
  );
});

export default Textarea;
