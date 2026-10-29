import { forwardRef, useId } from 'react';
import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';

const Select = forwardRef(function Select(
  { label, error, hint, options = [], placeholder, className, containerClassName, required, id: providedId, children, ...props },
  ref,
) {
  const generatedId = useId();
  const id = providedId || generatedId;
  const errorId = id + '-error';

  return (
    <div className={clsx('w-full', containerClassName)}>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink-700">
          {label}
          {required && <span className="ml-0.5 text-danger-600" aria-hidden="true">*</span>}
        </label>
      )}

      <div className="group relative">
        <select
          ref={ref}
          id={id}
          required={required}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? errorId : undefined}
          className={clsx(
            'h-11 w-full appearance-none rounded-field border bg-white pl-3 pr-9 text-base text-ink-800',
            'shadow-xs transition-[border-color,box-shadow] duration-200 ease-out',
            'cursor-pointer hover:border-ink-400 focus:outline-none focus:ring-4',
            error
              ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500/15'
              : 'border-ink-300 focus:border-brand-600 focus:ring-brand-600/15',
            'disabled:cursor-not-allowed disabled:bg-ink-50',
            className,
          )}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className={clsx(
            'pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2',
            'transition-colors duration-200',
            error ? 'text-danger-500' : 'text-ink-400 group-focus-within:text-brand-600',
          )}
        />
      </div>

      {error && <p id={errorId} role="alert" className="mt-1.5 text-sm text-danger-600">{error}</p>}
      {hint && !error && <p className="mt-1.5 text-sm text-ink-500">{hint}</p>}
    </div>
  );
});

export default Select;
