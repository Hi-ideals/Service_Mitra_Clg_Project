/**
 * Two-factor authentication.
 *
 * The password proves something you know. This proves something you hold. The
 * point of pairing them is that the common ways a password is lost - reuse on
 * a site that got breached, a phishing page, someone reading a screen - all
 * yield the password alone, and the password alone stops being enough.
 *
 * Three rules shape everything below.
 *
 * Enabling it is a two-step act: the secret is written when the QR code is
 * shown and only comes into force once a code from the app proves the
 * authenticator is really configured. Nobody is locked out by closing a tab.
 *
 * Turning it off is as protected as turning it on. Both need the password
 * again and a current code - otherwise a stolen session would be enough to
 * strip the second factor off and keep the account.
 *
 * There is always a way back in. Ten single-use recovery codes, shown once.
 * A security control with no recovery path is not a security control, it is a
 * trap waiting for the day somebody drops their phone.
 */
import bcrypt from 'bcryptjs';
import ApiError from '../../utils/ApiError.js';
import logger from '../../config/logger.js';
import * as totp from '../../services/totp.service.js';
import * as repo from './twofactor.repository.js';
import * as users from './auth.repository.js';

/** Re-authentication. Every change here is a change to how the account is protected. */
async function assertPassword(user, password) {
  const matches = await bcrypt.compare(password ?? '', user.password_hash);
  if (!matches) throw ApiError.unauthorized('That password is not correct');
}

/**
 * The account, with the one field needed to re-check the password.
 *
 * `findById` deliberately does not return the hash, so it is fetched
 * separately rather than widening a query the whole application uses.
 */
async function loadUser(userId) {
  const user = await users.findById(userId);
  if (!user) throw ApiError.notFound('Account not found');

  const secret = await users.getPasswordHash(userId);
  if (!secret) throw ApiError.notFound('Account not found');

  return { ...user, password_hash: secret.password_hash };
}

export async function status(userId) {
  const row = await repo.findByUser(userId);
  return {
    configured: totp.isConfigured(),
    enabled: Boolean(row?.confirmed_at),
    pending: Boolean(row && !row.confirmed_at),
    enabledAt: row?.confirmed_at ?? null,
    recoveryCodesRemaining: row?.confirmed_at ? await repo.countUnusedRecoveryCodes(userId) : 0,
  };
}

/**
 * Hands out a secret and the QR payload. Does not switch anything on.
 */
export async function beginSetup(userId, password) {
  if (!totp.isConfigured()) {
    throw new ApiError(503, 'Two-factor authentication is not configured on this server. ' +
      'Set TOTP_ENCRYPTION_KEY and restart.', { code: 'TOTP_NOT_CONFIGURED' });
  }

  const user = await loadUser(userId);
  await assertPassword(user, password);

  const existing = await repo.findByUser(userId);
  if (existing?.confirmed_at) {
    throw ApiError.conflict('Two-factor authentication is already on for this account');
  }

  const secret = totp.generateSecret();
  const saved = await repo.startSetup(userId, totp.encryptSecret(secret));
  if (!saved) throw ApiError.conflict('Two-factor authentication is already on for this account');

  return {
    secret,
    // The QR code is only a convenient way to transfer the secret; the string
    // is offered too, for an app that cannot use a camera.
    otpauthUri: totp.otpauthUri({ secret, account: user.email ?? user.phone ?? user.id }),
  };
}

/**
 * Starts enrolment for somebody who has just proved their password but holds
 * no session - an admin being made to set 2FA up before they are let in.
 *
 * No password check of its own: the login that calls this has already done it,
 * and the token it hands back is good for nothing except finishing here.
 */
export async function startEnrolmentForLogin(user) {
  const existing = await repo.findByUser(user.id);
  if (existing?.confirmed_at) {
    throw ApiError.conflict('Two-factor authentication is already on for this account');
  }

  const secret = totp.generateSecret();
  await repo.startSetup(user.id, totp.encryptSecret(secret));

  return {
    secret,
    otpauthUri: totp.otpauthUri({ secret, account: user.email ?? user.phone ?? user.id }),
  };
}

/**
 * Confirms the authenticator is really set up, and switches 2FA on.
 *
 * Returns the recovery codes. This is the only time they exist in readable
 * form - only their hashes are stored, so they cannot be shown again later.
 */
export async function confirmSetup(userId, code) {
  const row = await repo.findByUser(userId);
  if (!row) throw ApiError.badRequest('Start the setup again - there is nothing to confirm');
  if (row.confirmed_at) throw ApiError.conflict('Two-factor authentication is already on');

  const step = totp.verify(totp.decryptSecret(row.secret_encrypted), code);
  if (step === null) {
    throw ApiError.badRequest('That code is not right. Check your authenticator app and try again.');
  }

  const codes = totp.generateRecoveryCodes();
  await repo.confirm(userId, step, codes.map(totp.hashRecoveryCode));

  logger.info({ userId }, 'Two-factor authentication enabled');
  return { recoveryCodes: codes };
}

/**
 * Checks a code or a recovery code against an account that has 2FA on.
 *
 * Returns how it was satisfied, so the caller can tell the person a recovery
 * code was spent - someone who does not know they just used one will not
 * notice when they run out.
 */
export async function verifySecondFactor(userId, code) {
  const row = await repo.findByUser(userId);
  if (!row?.confirmed_at) throw ApiError.badRequest('Two-factor authentication is not on for this account');

  const candidate = String(code ?? '').trim();

  // A six-digit string is an authenticator code; anything else is treated as a
  // recovery code. Checked in that order because it is the common case.
  if (/^\d{6}$/.test(candidate)) {
    const step = totp.verify(totp.decryptSecret(row.secret_encrypted), candidate, {
      after: row.last_step === null ? null : Number(row.last_step),
    });

    // A valid code that has already been used returns null above, so a code
    // read over somebody's shoulder is good for one sign-in at most - and only
    // if the attacker gets there first.
    if (step !== null && (await repo.consumeStep(userId, step))) {
      return { method: 'app', recoveryCodesRemaining: null };
    }
    throw ApiError.unauthorized('That code is not right or has already been used');
  }

  if (await repo.consumeRecoveryCode(userId, totp.hashRecoveryCode(candidate))) {
    const remaining = await repo.countUnusedRecoveryCodes(userId);
    logger.warn({ userId, remaining }, 'Signed in with a two-factor recovery code');
    return { method: 'recovery', recoveryCodesRemaining: remaining };
  }

  throw ApiError.unauthorized('That code is not right or has already been used');
}

/** Both the password and a current code, because this removes a protection. */
export async function disable(userId, { password, code }) {
  const user = await loadUser(userId);
  await assertPassword(user, password);
  await verifySecondFactor(userId, code);

  await repo.disable(userId);
  logger.warn({ userId }, 'Two-factor authentication turned off');
  return { enabled: false };
}

/** A fresh set, for when the printed sheet is running low or has been lost. */
export async function regenerateRecoveryCodes(userId, { password, code }) {
  const user = await loadUser(userId);
  await assertPassword(user, password);
  await verifySecondFactor(userId, code);

  const codes = totp.generateRecoveryCodes();
  await repo.replaceRecoveryCodes(userId, codes.map(totp.hashRecoveryCode));

  logger.info({ userId }, 'Two-factor recovery codes replaced');
  return { recoveryCodes: codes };
}

export const isEnabled = repo.isEnabled;

export default {
  status, beginSetup, confirmSetup, verifySecondFactor, disable,
  regenerateRecoveryCodes, isEnabled,
};
