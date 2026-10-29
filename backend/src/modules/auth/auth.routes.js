/**
 * Auth routes. Each line declares who may reach the endpoint; the enforcement
 * itself lives in the middleware, never in the controller.
 */
import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { authenticate, reloadUser } from '../../middleware/authenticate.js';
import { authLimiter, otpLimiter, twoFactorLimiter } from '../../middleware/rateLimit.js';
import * as controller from './auth.controller.js';
import * as schema from './auth.validation.js';

const router = Router();

// ---------- public ----------
router.post('/register', authLimiter, validate({ body: schema.registerSchema }), controller.register);
router.post('/login', authLimiter, validate({ body: schema.loginSchema }), controller.login);
// The second half of a sign-in. Its own limiter, tighter than the login one:
// this endpoint accepts a six-digit code, and six digits is a space an
// attacker can search if nothing stops them trying.
router.post(
  '/login/2fa',
  twoFactorLimiter,
  validate({ body: schema.twoFactorLoginSchema }),
  controller.loginTwoFactor,
);

// Enrolment for an admin who has proved their password but has no session
// yet, and will not get one until this completes.
router.post(
  '/login/2fa/enrol',
  twoFactorLimiter,
  validate({ body: schema.twoFactorEnrolSchema }),
  controller.loginEnrol,
);

router.post('/refresh', validate({ body: schema.refreshSchema }), controller.refresh);
router.post('/logout', controller.logout);

router.post('/otp/send', otpLimiter, validate({ body: schema.sendOtpSchema }), controller.sendOtp);
router.post('/otp/verify', otpLimiter, validate({ body: schema.confirmContactSchema }), controller.confirmContact);
router.post('/password/reset', authLimiter, validate({ body: schema.resetPasswordSchema }), controller.resetPassword);

// ---------- signed in ----------
router.use(authenticate);

router.get('/me', controller.me);
router.patch('/me', validate({ body: schema.updateProfileSchema }), controller.updateProfile);
router.post('/logout-all', controller.logoutAll);

// Password change re-reads the account, so a stale token cannot be used to
// take over an account that was suspended a moment ago.
router.post(
  '/password/change',
  reloadUser,
  validate({ body: schema.changePasswordSchema }),
  controller.changePassword,
);

// ---------- two-factor settings ----------
//
// `reloadUser` on every one of these: they change how the account is
// protected, so a token minted before the account was suspended must not be
// enough to reach them.
router.get('/2fa', controller.twoFactorStatus);
router.post(
  '/2fa/setup',
  twoFactorLimiter,
  reloadUser,
  validate({ body: schema.twoFactorSetupSchema }),
  controller.twoFactorSetup,
);
router.post(
  '/2fa/enable',
  twoFactorLimiter,
  reloadUser,
  validate({ body: schema.twoFactorEnableSchema }),
  controller.twoFactorEnable,
);
router.post(
  '/2fa/disable',
  twoFactorLimiter,
  reloadUser,
  validate({ body: schema.twoFactorDisableSchema }),
  controller.twoFactorDisable,
);
router.post(
  '/2fa/recovery-codes',
  twoFactorLimiter,
  reloadUser,
  validate({ body: schema.twoFactorDisableSchema }),
  controller.twoFactorRecoveryCodes,
);

export default router;
