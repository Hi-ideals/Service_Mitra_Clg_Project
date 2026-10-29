import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { PageLoader } from '../components/ui/Spinner.jsx';

/**
 * Route guards.
 *
 * These are a convenience for the user, not a security boundary - the API
 * enforces every one of these rules again on each request. Their job is to
 * avoid showing someone a screen that will only refuse them.
 */

/** Where each role belongs when they land somewhere generic. */
export const HOME_FOR_ROLE = {
  customer: '/',
  provider: '/provider',
  admin: '/admin',
  agency: '/agency',
};

export function RequireAuth() {
  const { isAuthenticated, isRestoring } = useAuth();
  const location = useLocation();

  // Without this wait, a page reload flashes the sign-in screen before the
  // refresh cookie has had a chance to restore the session.
  if (isRestoring) return <PageLoader label="Restoring your session" />;

  if (!isAuthenticated) {
    // Remembered so the user lands where they were going, not on a dashboard.
    return <Navigate to="/signin" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

export function RequireRole({ role }) {
  const { user, isAuthenticated, isRestoring } = useAuth();
  const location = useLocation();
  const allowed = Array.isArray(role) ? role : [role];

  if (isRestoring) return <PageLoader label="Restoring your session" />;
  if (!isAuthenticated) return <Navigate to="/signin" replace state={{ from: location }} />;

  if (!allowed.includes(user.role)) {
    // Sent to their own home rather than a dead end, which is what a bare
    // "403" page amounts to when the user simply opened the wrong bookmark.
    return <Navigate to={HOME_FOR_ROLE[user.role] ?? '/'} replace />;
  }

  return <Outlet />;
}

/** Keeps a signed-in user off the sign-in and register screens. */
export function RedirectIfAuthenticated() {
  const { user, isAuthenticated, isRestoring } = useAuth();

  if (isRestoring) return <PageLoader />;
  if (isAuthenticated) return <Navigate to={HOME_FOR_ROLE[user.role] ?? '/'} replace />;

  return <Outlet />;
}
