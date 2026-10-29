/**
 * Mail server settings, editable from the admin console.
 *
 * The password is encrypted before it is stored and is never sent back to the
 * browser - the screen is told only whether one exists. Saving without typing
 * a password keeps the one already stored, so changing a port does not mean
 * re-typing a credential you may not have to hand.
 *
 * Nothing is saved until it has been proved to work. A mail server that is
 * configured but wrong is worse than one that is absent: email silently stops,
 * and the first sign of it is a customer saying they never got their invoice.
 */
import nodemailer from 'nodemailer';
import settings from '../../services/settings.service.js';
import * as secrets from '../../services/secrets.service.js';
import logger from '../../config/logger.js';
import env from '../../config/env.js';
import ApiError from '../../utils/ApiError.js';

const KEY = 'smtp';
const PURPOSE = 'smtp-password';

/** How the browser sees it: everything except the password. */
export function present(stored) {
  const config = stored ?? {};

  return {
    configured: secrets.isConfigured(),
    enabled: Boolean(config.enabled),
    host: config.host ?? '',
    port: config.port ?? 587,
    // 465 speaks TLS from the first byte; 587 starts in the clear and
    // upgrades. Getting this wrong is the most common reason a correct
    // username and password still fail to connect.
    secure: config.secure ?? false,
    username: config.username ?? '',
    fromName: config.fromName ?? 'ServiceMitra',
    fromEmail: config.fromEmail ?? '',
    hasPassword: Boolean(config.password),
    updatedAt: config.updatedAt ?? null,
    // What the server falls back to when this is off, so the screen can say
    // where mail is going today rather than leaving it a mystery.
    fallback: {
      driver: env.EMAIL_DRIVER,
      host: env.SMTP_HOST || null,
    },
  };
}

export async function current() {
  const stored = await settings.get(KEY);
  return present(stored);
}

/** The settings the mailer should use, password decrypted. Null when unset. */
export async function active() {
  const stored = await settings.get(KEY);
  if (!stored?.enabled || !stored.host) return null;

  let password;
  try {
    password = stored.password ? secrets.decrypt(stored.password, PURPOSE) : undefined;
  } catch (err) {
    // A key that no longer matches what encrypted this. Falling back to the
    // environment beats sending nothing, and saying so beats both.
    logger.error({ err: err.message }, 'Stored SMTP password could not be decrypted');
    return null;
  }

  return {
    host: stored.host,
    port: stored.port,
    secure: stored.secure,
    username: stored.username || undefined,
    password,
    from: stored.fromEmail
      ? (stored.fromName ? stored.fromName + ' <' + stored.fromEmail + '>' : stored.fromEmail)
      : undefined,
  };
}

function transportFor({ host, port, secure, username, password }) {
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: username ? { user: username, pass: password } : undefined,
    // Short, because somebody is watching a spinner. The default lets a
    // wrong host hang for minutes.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
  });
}

/**
 * Connects and authenticates, without sending anything.
 *
 * nodemailer's errors are written for developers. The common three are
 * translated, because "ENOTFOUND" tells the person reading it nothing about
 * what to change.
 */
export async function check(config) {
  try {
    await transportFor(config).verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: explain(err) };
  }
}

function explain(err) {
  const code = err.code || '';
  const message = err.message || String(err);

  if (code === 'EAUTH') {
    return 'The server rejected that username and password. For Gmail, use an app password rather than your account password.';
  }
  if (code === 'ENOTFOUND' || code === 'EDNS') {
    return 'That host name could not be found. Check the spelling of the server address.';
  }
  if (code === 'ETIMEDOUT' || code === 'ECONNECTION' || code === 'ESOCKET') {
    return 'Could not connect on that port. Port 587 is usual, or 465 with SSL/TLS switched on.';
  }
  return message;
}

/**
 * Saves, but only after connecting successfully with exactly these settings.
 *
 * An untested save is how email stops without anyone noticing.
 */
export async function save(input, adminId) {
  if (!secrets.isConfigured()) {
    throw new ApiError(503, 'This server cannot store a mail password: TOTP_ENCRYPTION_KEY is not set.', {
      code: 'ENCRYPTION_NOT_CONFIGURED',
    });
  }

  const stored = (await settings.get(KEY)) ?? {};

  // An empty password field means "leave the stored one alone", so that
  // editing a port does not require re-typing a credential.
  let password = stored.password;
  if (input.password) password = secrets.encrypt(input.password, PURPOSE);

  if (input.enabled) {
    if (!input.host) throw ApiError.badRequest('Enter the mail server address');
    if (!password) throw ApiError.badRequest('Enter the password for this mail account');

    const result = await check({
      host: input.host,
      port: input.port,
      secure: input.secure,
      username: input.username || undefined,
      password: secrets.decrypt(password, PURPOSE),
    });

    if (!result.ok) {
      throw new ApiError(400, 'Those settings did not work: ' + result.error, {
        code: 'SMTP_CHECK_FAILED',
      });
    }
  }

  const value = {
    enabled: Boolean(input.enabled),
    host: input.host ?? '',
    port: input.port ?? 587,
    secure: Boolean(input.secure),
    username: input.username ?? '',
    fromName: input.fromName ?? 'ServiceMitra',
    fromEmail: input.fromEmail ?? '',
    password,
    updatedAt: new Date().toISOString(),
  };

  await settings.update(KEY, value, adminId);

  // The mailer pools connections. Without this the next email would go out
  // over the old server, and a correct change would look broken.
  const { resetTransport } = await import('../../services/email/mailer.js');
  resetTransport();

  logger.info({ host: value.host, enabled: value.enabled }, 'SMTP settings updated');

  return present(value);
}

/** Sends a real message, so the whole path is proved rather than the connection alone. */
export async function sendTest(to) {
  const config = await active();
  if (!config) throw ApiError.badRequest('Save working mail settings before sending a test');

  try {
    await transportFor(config).sendMail({
      from: config.from || config.username,
      to,
      subject: 'ServiceMitra test email',
      text:
        'This is a test from your ServiceMitra admin console.\n\n' +
        'If you are reading it, your mail settings work and customers will ' +
        'receive their codes and invoices.',
    });

    return { sent: true, to };
  } catch (err) {
    throw new ApiError(400, 'The test email could not be sent: ' + explain(err), {
      code: 'SMTP_SEND_FAILED',
    });
  }
}

export default { current, active, save, sendTest, check, present };
