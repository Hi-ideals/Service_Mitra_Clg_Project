/**
 * Email delivery.
 *
 * OTP moved from SMS to email because every SMS costs money and email does
 * not - at the volume a marketplace sends verification and reset codes, that
 * is the difference between a line item and a rounding error.
 *
 * Two drivers, same interface. `console` prints to the log so the whole flow
 * is testable with no provider at all; `smtp` sends for real. Nothing outside
 * this file knows which is in use.
 */
import { fileURLToPath } from 'node:url';

import nodemailer from 'nodemailer';
import env from '../../config/env.js';
import logger from '../../config/logger.js';
import { LOGO_CID } from './templates.js';

/**
 * The logo that `templates.js` references as `cid:servicemitra-logo`.
 *
 * Resolved from this module's own URL rather than from the working directory,
 * because the API is started from different places - npm scripts, the Docker
 * image, a scheduled task - and a relative path silently becomes a missing
 * image in exactly one of them.
 */
const LOGO_PATH = fileURLToPath(new URL('./assets/email-logo.png', import.meta.url));

let transporter = null;
let transportKey = null;

/**
 * What the admin console saved, or null when it has saved nothing.
 *
 * Imported lazily. The admin module reads settings, which reads the database,
 * and importing it at the top of the mail service would make the mailer part
 * of that cycle for no benefit.
 */
async function savedConfig() {
  try {
    const { active } = await import('../../modules/admin/smtp.service.js');
    return await active();
  } catch (err) {
    logger.error({ err: err.message }, 'Could not read saved mail settings');
    return null;
  }
}

/**
 * Built once and reused - a new SMTP connection per email is slow and rude.
 *
 * Keyed on the settings themselves, so saving different ones in the admin
 * console takes effect on the next email rather than on the next restart. A
 * cached connection to the old server would make a correct change look broken.
 */
function transportFor(config) {
  const key = JSON.stringify([config.host, config.port, config.secure, config.username]);
  if (transporter && transportKey === key) return transporter;

  if (transporter) {
    transporter.close();
    logger.info({ host: config.host }, 'Mail settings changed, reconnecting');
  }

  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    // 465 is implicit TLS; 587 upgrades with STARTTLS.
    secure: config.secure,
    auth: config.username ? { user: config.username, pass: config.password } : undefined,
    pool: true,
    maxConnections: 3,
  });
  transportKey = key;

  return transporter;
}

/** The environment's settings, used when the admin console has saved none. */
function envConfig() {
  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    username: env.SMTP_USER || undefined,
    password: env.SMTP_PASSWORD,
    from: env.EMAIL_FROM,
  };
}

/**
 * Where mail should go out from right now.
 *
 * Saved settings win over the environment - that is the point of the screen -
 * but the environment remains the fallback, so turning the saved ones off
 * restores whatever the server was deployed with rather than breaking mail.
 */
async function resolveConfig() {
  return (await savedConfig()) ?? envConfig();
}

const drivers = {
  /**
   * Development driver. Prints the subject and, when there is one, the code -
   * so a developer can complete a sign-up without an inbox.
   */
  async send({ to, subject, text }) {
    const code = text?.match(/code is: (\d{4,8})/)?.[1];
    logger.info(
      { to, subject, code },
      '[EMAIL -> ' + to + '] ' + subject + (code ? '  code: ' + code : ''),
    );
    return { delivered: true, driver: 'console' };
  },
};

const smtpDriver = {
  async send({ to, subject, html, text }) {
    // Attached only when the body actually references it. A message that
    // carries an image nothing points at is just a bigger message.
    const embedsLogo = typeof html === 'string' && html.includes('cid:' + LOGO_CID);

    const config = await resolveConfig();
    const info = await transportFor(config).sendMail({
      from: config.from || env.EMAIL_FROM,
      to,
      subject,
      text,
      html,
      attachments: embedsLogo
        ? [
            {
              filename: 'servicemitra.png',
              path: LOGO_PATH,
              cid: LOGO_CID,
              // Without this the client lists it as a file on the message, and
              // an OTP email that looks like it carries an attachment is
              // exactly what people are told not to open.
              contentDisposition: 'inline',
            },
          ]
        : undefined,
    });
    return { delivered: true, driver: 'smtp', messageId: info.messageId };
  },
};

/**
 * Which driver sends the next email.
 *
 * Saved settings turn SMTP on by themselves. A server deployed with
 * EMAIL_DRIVER=console still sends real mail once an admin has configured and
 * enabled a mail server from the console - otherwise the screen would appear
 * to work while every message went to the log.
 */
async function driver() {
  if (env.EMAIL_DRIVER === 'smtp') return smtpDriver;
  return (await savedConfig()) ? smtpDriver : drivers;
}

/**
 * Sends one email. Throws on failure so the caller can record it - the
 * notification service turns that into a retryable row rather than silence.
 */
export async function sendEmail({ to, subject, html, text }) {
  if (!to) throw new Error('No email address to send to');
  return (await driver()).send({ to, subject, html, text });
}

/** Confirms the SMTP settings actually work, at boot rather than at 2am. */
/**
 * Whether a code may be returned in the API response.
 *
 * Only when nothing was actually sent. The console driver prints to the log
 * and delivers no mail, so without this a developer could never sign up. The
 * moment a real mail server is configured the email IS the delivery, and
 * echoing the code back would hand it to anyone who can call the endpoint -
 * no inbox required.
 *
 * Deliberately keyed on the driver rather than NODE_ENV: a staging box with
 * working SMTP is not production, but its codes are just as real.
 */
export function codeCanBeEchoed() {
  return env.EMAIL_DRIVER === 'console' && !env.isProd;
}

/**
 * Drops the cached connection.
 *
 * Called when the admin saves new settings, so the next email uses them
 * immediately. The key check in `transportFor` would catch it anyway; this
 * makes the change instant rather than merely eventual.
 */
export function resetTransport() {
  if (transporter) transporter.close();
  transporter = null;
  transportKey = null;
}

export async function verifyTransport() {
  const saved = await savedConfig();
  if (env.EMAIL_DRIVER !== 'smtp' && !saved) return { ok: true, driver: 'console' };

  const config = saved ?? envConfig();

  try {
    await transportFor(config).verify();
    logger.info({ host: config.host }, 'SMTP connection verified');
    return { ok: true, driver: 'smtp' };
  } catch (err) {
    // Not fatal: the API should still serve traffic if email is misconfigured.
    logger.error({ err: err.message }, 'SMTP verification failed - emails will not send');
    return { ok: false, driver: 'smtp', error: err.message };
  }
}

export default { sendEmail, verifyTransport, resetTransport };
