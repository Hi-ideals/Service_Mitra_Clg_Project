import { useEffect } from 'react';

const SUFFIX = ' · ServiceMitra';

/**
 * Sets the document title for a screen.
 *
 * Not cosmetic: a screen reader announces the title on navigation, and without
 * it every entry in the browser history reads identically, which makes the
 * back button guesswork.
 */
export default function useDocumentTitle(title) {
  useEffect(() => {
    if (!title) return undefined;

    const previous = document.title;
    document.title = title + SUFFIX;

    return () => {
      document.title = previous;
    };
  }, [title]);
}
