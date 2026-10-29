/**
 * Gates 2, 3 and 4 - role, provider verification and resource ownership.
 *
 * Role alone is not enough in a marketplace. A verified provider may accept
 * bookings, but only bookings assigned to them; an admin skips the ownership
 * check but is audit-logged instead.
 */
import { ROLES, VERIFICATION_STATUS } from '../config/constants.js';
import { queryOne } from '../db/pool.js';
import ApiError from '../utils/ApiError.js';

/** authorize('admin') or authorize('provider', 'admin') */
export function authorize(...roles) {
  const allowed = new Set(roles.flat());
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized('Sign in to continue'));
    if (!allowed.has(req.user.role)) {
      return next(
        ApiError.forbidden('This action is available to ' + [...allowed].join(' or ') + ' accounts only'),
      );
    }
    return next();
  };
}

export const customerOnly = authorize(ROLES.CUSTOMER);
export const providerOnly = authorize(ROLES.PROVIDER);
export const adminOnly = authorize(ROLES.ADMIN);
export const agencyOnly = authorize(ROLES.AGENCY);

/**
 * The verification gate. A provider can sign in and build a profile while
 * unverified, but cannot become commercially live until an admin approves the
 * KYC - so anything that earns money or accepts work passes through here.
 */
export function requireVerifiedProvider(req, _res, next) {
  if (!req.user) return next(ApiError.unauthorized('Sign in to continue'));
  if (req.user.role !== ROLES.PROVIDER) {
    return next(ApiError.forbidden('This action is available to service provider accounts only'));
  }

  const status = req.user.verification;
  if (status === VERIFICATION_STATUS.APPROVED) return next();

  const message = {
    [VERIFICATION_STATUS.UNSUBMITTED]: 'Submit your KYC documents to start accepting bookings',
    [VERIFICATION_STATUS.PENDING]: 'Your KYC is under review. You can accept bookings once it is approved',
    [VERIFICATION_STATUS.INFO_REQUESTED]: 'Our team has requested more information before approving your account',
    [VERIFICATION_STATUS.REJECTED]: 'Your verification was rejected. Please re-submit your documents',
    [VERIFICATION_STATUS.SUSPENDED]: 'Your account is suspended. Contact support for help',
  }[status] || 'Your account is not verified yet';

  return next(new ApiError(403, message, { code: 'PROVIDER_NOT_VERIFIED', details: { status } }));
}

/**
 * Ownership check. Confirms the record actually belongs to the caller before
 * business logic runs. Admins bypass it by design.
 *
 *   ownsResource({ table: 'bookings', column: 'customer_id' })
 */
export function ownsResource({ table, column, param = 'id', allowAdmin = true, alias = null }) {
  return async (req, _res, next) => {
    try {
      if (allowAdmin && req.user.role === ROLES.ADMIN) return next();

      const id = req.params[param];
      const row = await queryOne('SELECT ' + column + ' AS owner FROM ' + table + ' WHERE id = $1', [id]);

      if (!row) return next(ApiError.notFound('Record not found'));

      // A provider owns rows keyed by their profile id, not their user id.
      const mine =
        req.user.role === ROLES.PROVIDER && column.startsWith('provider')
          ? req.user.providerId
          : req.user.id;

      if (row.owner !== mine) {
        return next(ApiError.forbidden('You do not have access to this record'));
      }

      if (alias) req.resource = { ...(req.resource ?? {}), [alias]: row };
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export default authorize;
