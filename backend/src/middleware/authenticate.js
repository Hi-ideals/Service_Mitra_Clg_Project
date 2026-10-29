/**
 * Gate 1 - authentication. Resolves the bearer token into req.user.
 *
 * The token carries role and verification status, so the common path costs no
 * database round trip. Account status is re-read only when the token says the
 * account was not plainly active at sign-in time.
 */
import { verifyAccessToken } from '../services/token.service.js';
import { queryOne } from '../db/pool.js';
import ApiError from '../utils/ApiError.js';

function extract(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

export function authenticate(req, _res, next) {
  const token = extract(req);
  if (!token) return next(ApiError.unauthorized('Sign in to continue'));

  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      role: payload.role,
      verification: payload.verification,
      providerId: payload.providerId,
      agencyId: payload.agencyId,
      status: payload.status,
    };
    if (req.user.status !== 'active') {
      return next(ApiError.forbidden('This account is ' + req.user.status));
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * For public endpoints that show more when signed in - a provider profile that
 * also reveals whether the viewer has booked this provider before.
 */
export function optionalAuth(req, _res, next) {
  const token = extract(req);
  if (!token) return next();
  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      role: payload.role,
      verification: payload.verification,
      providerId: payload.providerId,
      agencyId: payload.agencyId,
      status: payload.status,
    };
  } catch {
    // An invalid token on a public route is simply an anonymous visitor.
  }
  return next();
}

/**
 * Re-reads the account from the database. Used by endpoints where a stale
 * token must not win - changing a password, or acting on money.
 */
export async function reloadUser(req, _res, next) {
  try {
    const row = await queryOne(
      `SELECT u.id, u.role, u.status, u.email, u.phone,
              p.id AS provider_id, p.verification_status,
              a.id AS agency_id, a.verification_status AS agency_verification
         FROM users u
         LEFT JOIN provider_profiles p ON p.user_id = u.id AND p.deleted_at IS NULL
         LEFT JOIN agencies a ON a.user_id = u.id AND a.deleted_at IS NULL
        WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [req.user.id],
    );
    if (!row) return next(ApiError.unauthorized('Account no longer exists'));
    if (row.status !== 'active') return next(ApiError.forbidden('This account is ' + row.status));

    req.user = {
      id: row.id,
      role: row.role,
      status: row.status,
      email: row.email,
      phone: row.phone,
      providerId: row.provider_id,
      agencyId: row.agency_id,
      // An agency account has no provider profile, so its own approval is the
      // verification that matters to it.
      verification: row.verification_status ?? row.agency_verification,
    };
    return next();
  } catch (err) {
    return next(err);
  }
}

export default authenticate;
