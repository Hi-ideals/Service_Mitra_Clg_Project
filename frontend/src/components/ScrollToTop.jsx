import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Resets scroll on navigation.
 *
 * Without this, following a search result to a provider profile leaves the
 * user halfway down the new page, which reads as a broken link.
 */
export default function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);

  return null;
}
