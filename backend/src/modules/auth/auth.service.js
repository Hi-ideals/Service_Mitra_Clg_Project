/**
 * Authentication business logic. Knows nothing about HTTP.
 */
import bcrypt from 'bcryptjs';
import { withTransaction } from '../../db/pool.js';
import env from '../../config/env.js';
import { ROLES } from '../../config/constants.js';
import ApiError from '../../utils/ApiError.js';
import * as repo from './auth.repository.js';
import * as tokens from '../../services/token.service.js';
import { issueOtp, verifyOtp, OTP_PURPOSE } from '../../services/otp.service.js';
import * as twoFactor from './twofactor.service.js';
import { notifyAsync } from '../../services/notification.service.js';

/** The shape the API returns for a user. Never includes the password hash. */
function present(user) {
  return {
    id: user.id,
    role: user.role,
    fullName: user.full_name,
    email: user.email,
    phone: user.phone,
    avatarUrl: user.avatar_url ?? null,
    status: user.status,
    emailVerified: Boolean(user.email_verified_at),
    phoneVerified: Boolean(user.phone_verified_at),
    providerId: user.provider_id ?? null,
    verificationStatus: user.verification_status ?? null,
    createdAt: user.created_at,
  };
}

async function issueSession(user, context) {
  const accessToken = tokens.signAccessToken(user);
  const refresh = await tokens.issueRefreshToken(user.id, context);
  return { accessToken, refreshToken: refresh.token, refreshExpiresAt: refresh.expiresAt };
}

/**
 * Registration. A customer is usable immediately; a provider is created
 * together with an unverified profile and stays invisible to customers until
 * an admin approves their KYC.
 */
export async function register({ role, fullName, email, phone, password, agencyName }, context = {}) {
  if (role === ROLES.ADMIN) {
    // Admins are provisioned internally, never through the public API.
    throw ApiError.forbidden('Admin accounts cannot be self-registered');
  }

  const existing = await repo.findByEmailOrPhone(email, phone);
  if (existing) {
    /**
     * An account that never confirmed itself does not hold its email address.
     *
     * Without this, one mistyped domain - or one accidental refresh - would
     * reserve a real person's own address against an account nobody can ever
     * sign into, and they would have to wait for a cleanup job before they
     * could try again. Almost nobody waits. They leave.
     *
     * Safe because an unconfirmed account can never have been signed into, so
     * there is nothing of anyone's to lose.
     */
    if (!existing.email_verified_at && existing.role !== ROLES.ADMIN) {
      await repo.deleteUnverified(existing.id);
    } else {
      const field = existing.email && email && existing.email.toLowerCase() === email.toLowerCase() ? 'email address' : 'phone number';
      throw ApiError.conflict('An account with this ' + field + ' already exists');
    }
  }

  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);

  const created = await withTransaction(async (tx) => {
    const user = await repo.createUser(tx, { role, fullName, email, phone, passwordHash });
    let profile = null;
    let agency = null;

    if (role === ROLES.PROVIDER) {
      profile = await repo.createProviderProfile(tx, user.id);
    } else if (role === ROLES.AGENCY) {
      // The agency's own business name defaults to the name they signed up
      // with; they rename it on their profile page.
      agency = await repo.createAgency(tx, user.id, { name: agencyName?.trim() || fullName });
    }

    return { user, profile, agency };
  });

  const user = {
    ...created.user,
    provider_id: created.profile?.id ?? null,
    agency_id: created.agency?.id ?? null,
    verification_status:
      created.profile?.verification_status ?? created.agency?.verification_status ?? null,
  };

  // Contact confirmation is required before the account is fully usable. The
  // code is keyed to the email address but may be delivered over WhatsApp -
  // see otp.service.js. The phone is passed so that choice is available.
  const otp = await issueOtp({
    userId: user.id,
    destination: email,
    phone,
    purpose: OTP_PURPOSE.VERIFY_EMAIL,
  });

  /**
   * No session. Deliberately.
   *
   * Until the code is confirmed, nothing about this account works - it cannot
   * book, it cannot be signed into, it holds no token. Registration used to
   * hand over a full session here and treat the code as a formality, which
   * meant a made-up email and a made-up phone number got a working account
   * and could book a real professional who would then drive to an address
   * and find nobody reachable.
   */
  return {
    user: present(user),
    verification: {
      required: true,
      // The key the code is filed under. The client sends this back verbatim
      // to confirm, so it must stay the address and never become the masked
      // phone number the customer is shown.
      destination: email,
      // What to tell them to check - a masked number when WhatsApp carried
      // it, the address when email did.
      sentTo: otp.sentTo,
      // The channel that actually carried it, which differs from the one
      // preferred whenever WhatsApp failed and email picked it up.
      channel: otp.channel,
      expiresAt: otp.expiresAt,
      devCode: otp.devCode,
    },
  };
}

export async function login({ identifier, password }, context = {}) {
  const user = await repo.findForLogin(identifier);

  // The same message for an unknown account and a wrong password, so the
  // endpoint cannot be used to discover who has an account.
  const invalid = ApiError.unauthorized('Incorrect email/phone or password');
  if (!user) {
    // Constant-ish work regardless of outcome, to blunt timing analysis.
    await bcrypt.compare(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin');
    throw invalid;
  }

  const matches = await bcrypt.compare(password, user.password_hash);
  if (!matches) throw invalid;

  if (user.status !== 'active') {
    throw ApiError.forbidden('This account is ' + user.status + '. Contact support for help.');
  }

  /**
   * Confirmed contact details, or no session.
   *
   * Checked here as well as at registration, and that is the whole point:
   * stopping registration alone would achieve nothing, because the password
   * was chosen by the same person a moment earlier and they would simply sign
   * in instead.
   */
  if (!user.email_verified_at) {
    throw new ApiError(403, 'This account was never confirmed. Create your account again to get a new code.', {
      code: 'ACCOUNT_UNVERIFIED',
    });
  }

  const hasTwoFactor = await twoFactor.isEnabled(user.id);

  /**
   * An admin who has not enrolled is not let in.
   *
   * Not "let in and then restricted": no access token, no refresh token, no
   * session of any kind. What comes back is a token good for exactly one
   * thing - finishing the setup below - so there is no admin route that could
   * be reached by forgetting to guard it.
   */
  if (!hasTwoFactor && user.role === ROLES.ADMIN && env.REQUIRE_ADMIN_2FA) {
    const enrolment = await twoFactor.startEnrolmentForLogin(user);
    return {
      twoFactorSetupRequired: true,
      setupToken: tokens.signEnrolmentToken(user),
      ...enrolment,
      expiresInSeconds: 600,
    };
  }

  // Second factor, if this account has one.
  //
  // No session is issued here. The password has been proved and nothing more,
  // so what comes back is a short-lived token that is good for exactly one
  // thing: presenting a code at /auth/login/2fa. It carries its own audience,
  // so it cannot be used as an access token anywhere else.
  if (hasTwoFactor) {
    return {
      twoFactorRequired: true,
      challengeToken: tokens.signChallengeToken(user),
      // Shown to the person so they know the attempt will not wait forever.
      expiresInSeconds: 300,
    };
  }

  await repo.touchLastLogin(user.id);
  const session = await issueSession(user, context);

  return { user: present(user), ...session };
}

/**
 * Finishes enrolment and signs the admin in, in one step.
 *
 * The recovery codes come back with the session because this is the only
 * moment they exist in readable form - and because somebody being made to do
 * this on their way to somewhere else will not come back for them later.
 */
export async function completeTwoFactorEnrolment({ setupToken, code }, context = {}) {
  let payload;
  try {
    payload = tokens.verifyEnrolmentToken(setupToken);
  } catch {
    throw ApiError.unauthorized('That sign-in attempt has expired. Start again.');
  }

  const { recoveryCodes } = await twoFactor.confirmSetup(payload.sub, code);

  const user = await repo.findForLoginById(payload.sub);
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  if (user.status !== 'active') {
    throw ApiError.forbidden('This account is ' + user.status + '. Contact support for help.');
  }

  await repo.touchLastLogin(user.id);
  const session = await issueSession(user, context);

  return { user: present(user), ...session, recoveryCodes };
}

/**
 * The second half of a sign-in.
 *
 * Re-reads the account rather than trusting what was true when the password
 * was checked: five minutes is long enough for an admin to have suspended
 * somebody between the two halves, and that suspension must take effect here
 * rather than being bypassed by an in-flight login.
 */
export async function completeTwoFactorLogin({ challengeToken, code }, context = {}) {
  let payload;
  try {
    payload = tokens.verifyChallengeToken(challengeToken);
  } catch {
    throw ApiError.unauthorized('That sign-in attempt has expired. Start again.');
  }

  const result = await twoFactor.verifySecondFactor(payload.sub, code);

  const user = await repo.findForLoginById(payload.sub);
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  if (user.status !== 'active') {
    throw ApiError.forbidden('This account is ' + user.status + '. Contact support for help.');
  }

  await repo.touchLastLogin(user.id);
  const session = await issueSession(user, context);

  return {
    user: present(user),
    ...session,
    // Surfaced so the screen can warn when a recovery code was spent. Somebody
    // who does not notice will not know they are running out.
    usedRecoveryCode: result.method === 'recovery',
    recoveryCodesRemaining: result.recoveryCodesRemaining,
  };
}

export async function refresh(refreshToken, context = {}) {
  const rotated = await tokens.rotateRefreshToken(refreshToken, context);
  const user = await repo.findById(rotated.userId);
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  if (user.status !== 'active') throw ApiError.forbidden('This account is ' + user.status);

  /**
   * Checked here too, not only at login.
   *
   * Without this, every admin session that existed before the requirement was
   * switched on would keep renewing itself for thirty days. With it, the
   * longest any of them survives is the life of one access token.
   */
  if (user.role === ROLES.ADMIN && env.REQUIRE_ADMIN_2FA && !(await twoFactor.isEnabled(user.id))) {
    await tokens.revokeAllForUser(user.id, 'admin_2fa_required');
    throw ApiError.forbidden(
      'Admin accounts now need two-factor authentication. Sign in again to set it up.',
    );
  }

  return {
    user: present(user),
    accessToken: tokens.signAccessToken(user),
    refreshToken: rotated.token,
    refreshExpiresAt: rotated.expiresAt,
  };
}

export async function logout(refreshToken) {
  await tokens.revokeRefreshToken(refreshToken, 'logout');
}

export async function logoutEverywhere(userId) {
  const count = await tokens.revokeAllForUser(userId, 'logout_all');
  return { sessionsRevoked: count };
}

export async function me(userId) {
  const user = await repo.findById(userId);
  if (!user) throw ApiError.notFound('Account not found');
  return present(user);
}

export async function updateProfile(userId, payload) {
  const updated = await repo.updateProfile(userId, payload);
  if (!updated) throw ApiError.notFound('Account not found');
  return present(updated);
}

// ---------------------------------------------------------------- contact and password

export async function sendOtp({ destination, purpose }) {
  // Someone may sign in with a phone number but still need the code elsewhere,
  // so the account is looked up either way and the code goes to the contact
  // details on the account.
  const user = await repo.findForLogin(destination);

  // For password reset we never reveal whether the account exists.
  if (purpose === OTP_PURPOSE.RESET_PASSWORD && !user) {
    return {
      sent: true,
      destination,
      sentTo: destination,
      // Reports the configured preference rather than a fixed 'email'. A real
      // account now answers with whichever channel carried the code, so a
      // hardcoded value here would differ from a genuine response and tell an
      // attacker that the address is not registered - which is the one thing
      // this branch exists to hide.
      channel: env.OTP_CHANNEL,
      expiresAt: new Date(Date.now() + 600000),
    };
  }

  if (!user) throw ApiError.notFound('No account found for this email or phone number');

  if (!user.email) {
    throw ApiError.badRequest(
      'This account has no email address, and codes are sent by email. Contact support for help.',
    );
  }

  const otp = await issueOtp({
    userId: user.id,
    destination: user.email,
    phone: user.phone,
    purpose,
  });

  return {
    sent: true,
    // The lookup key, sent back unchanged when the code is confirmed.
    destination: user.email,
    // Where to tell them to look.
    sentTo: otp.sentTo,
    channel: otp.channel,
    expiresAt: otp.expiresAt,
    devCode: otp.devCode,
  };
}

/** Confirms a phone or email at registration. */
export async function confirmContact({ destination, code }, context = {}) {
  const { userId } = await verifyOtp({
    destination,
    purpose: OTP_PURPOSE.VERIFY_EMAIL,
    code,
  });

  if (userId) {
    await repo.markContactVerified(userId, 'email');
    notifyAsync({
      userId,
      eventType: 'account.verified',
      title: 'Account confirmed',
      body: 'Your email address has been confirmed.',
    });
  }

  if (!userId) return { verified: true, user: null };

  const user = await repo.findForLoginById(userId);
  if (!user) throw ApiError.notFound('Account not found');

  // The session is issued here, and only here - this is the moment the
  // account becomes real.
  await repo.touchLastLogin(user.id);
  const session = await issueSession(user, context);

  return { verified: true, user: present(user), ...session };
}

export async function changePassword(userId, { currentPassword, newPassword }) {
  const row = await repo.getPasswordHash(userId);
  if (!row) throw ApiError.notFound('Account not found');

  const matches = await bcrypt.compare(currentPassword, row.password_hash);
  if (!matches) throw ApiError.badRequest('Your current password is incorrect');

  if (currentPassword === newPassword) {
    throw ApiError.badRequest('The new password must be different from the current one');
  }

  await repo.updatePassword(userId, await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS));

  // Every other session is dropped, so a password change actually locks out
  // whoever else was signed in.
  const revoked = await tokens.revokeAllForUser(userId, 'password_changed');

  notifyAsync({
    userId,
    eventType: 'account.password_changed',
    title: 'Your password was changed',
    body: 'If this was not you, contact ServiceMitra support immediately.',
  });

  return { sessionsRevoked: revoked };
}

export async function resetPassword({ destination, code, newPassword }) {
  const { userId } = await verifyOtp({
    destination,
    purpose: OTP_PURPOSE.RESET_PASSWORD,
    code,
  });

  if (!userId) throw ApiError.badRequest('This reset link is no longer valid');

  await repo.updatePassword(userId, await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS));
  const revoked = await tokens.revokeAllForUser(userId, 'password_reset');

  notifyAsync({
    userId,
    eventType: 'account.password_reset',
    title: 'Your password was reset',
    body: 'Your ServiceMitra password was reset. If this was not you, contact support immediately.',
  });

  return { reset: true, sessionsRevoked: revoked };
}

export default {
  register,
  login,
  refresh,
  logout,
  logoutEverywhere,
  me,
  updateProfile,
  sendOtp,
  confirmContact,
  changePassword,
  resetPassword,
};
