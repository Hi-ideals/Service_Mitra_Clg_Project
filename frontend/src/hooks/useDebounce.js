import { useEffect, useState } from 'react';

/**
 * Delays a value until it stops changing.
 *
 * Used for search input: firing a request on every keystroke would hammer the
 * API and show results for a half-typed word.
 */
export default function useDebounce(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
