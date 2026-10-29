/**
 * One-time passwords for contact verification, password reset and job
 * completion confirmation.
 *
 * Codes go by **email**. SMS was the obvious channel for a marketplace whose
 * users are phone-first, but every message has a per-send cost and a
 * verification code is the single highest-volume message the platform sends.
 * Email is free, and the account already has an address on it.
 *
 * Codes are stored hashed and carry an attempt counter, so a leaked table row
 * reveals nothing and guessing is bounded.
 */
import bcrypt from 'bcryptjs';
import { query, queryOne } from '../db/pool.js';
import { numericOtp } from '../utils/helpers.js';
import ApiError from '../utils/ApiError.js';
import env from '../config/env.js';
import logger from '../config/logger.js';
import { notify } from './notification.service.js';
import { otpEmail } from './email/templates.js';
import { codeCanBeEchoed } from './email/mailer.js';
import * as whatsapp from './whatsapp/client.js';
import { toE164, maskPhone } from '../utils/phone.js';

const TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;

export const OTP_PURPOSE = Object.freeze({
  VERIFY_EMAIL: 'verify_email',
  VERIFY_PHONE: 'verify_phone',
  RESET_PASSWORD: 'reset_password',
  COMPLETE_JOB: 'complete_job',
});

/** A destination must be an email address now that codes travel by email. */
export function assertEmailDestination(destination) {
  if (!destination || !destination.includes('@')) {
    throw ApiError.badRequest(
      'Verification codes are sent by email. Add an email address to your account first.',
    );
  }
  return destination;
}

/**
 * Delivers a code, preferring WhatsApp and falling back to email.
 *
 * Returns which channel actually carried it, because the interface has to tell
 * the customer where to look and guessing wrong is worse than not saying.
 *
 * WhatsApp failure is expected, not exceptional: the number may not be on
 * WhatsApp at all, the customer may have blocked business messages, or Meta
 * may be refusing a template that was fine yesterday. None of those should
 * stop someone creating an account, so every one falls through to email.
 */
async function deliver({ userId, email, phone, purpose, code, extra, prefer }) {
  const wantsWhatsApp = prefer === 'whatsapp' && Boolean(toE164(phone));

  if (wantsWhatsApp) {
    try {
      await notify({
        userId,
        channel: 'whatsapp',
        destination: phone,
        eventType: 'otp.' + purpose,
        title: 'Your verification code',
        body: 'Your verification code was sent on WhatsApp.',
        // The code travels in `data` rather than the body: the body is stored
        // on the notification row, and a code sitting in the database in clear
        // text outlives its ten-minute life by however long that row is kept.
        data: { code },
        // notify() swallows delivery failures by design. A code that did not
        // arrive has to reach the catch below, or the fallback never fires and
        // the customer waits for a message that was never sent.
        rethrow: true,
      });

      return {
        channel: 'whatsapp',
        sentTo: maskPhone(phone),
        devCode: whatsapp.codeCanBeEchoed() ? code : undefined,
      };
    } catch (err) {
      logger.warn(
        { err: err.message, purpose },
        'WhatsApp could not carry the code, falling back to email',
      );
    }
  }

  const content = otpEmail({ purpose, code, minutes: TTL_MINUTES, extra });

  await notify({
    userId,
    channel: 'email',
    destination: email,
    eventType: 'otp.' + purpose,
    title: content.subject,
    body: 'Your verification code was sent by email.',
    email: content,
  });

  return {
    channel: 'email',
    sentTo: email,
    devCode: codeCanBeEchoed() ? code : undefined,
  };
}

/**
 * Issues a code and delivers it.
 *
 * `destination` stays the email address even when the code travels over
 * WhatsApp. It is the key the code is stored and verified against, so keeping
 * it stable means a code that fell back to email still verifies, and the
 * confirm step does not have to know which channel carried it.
 *
 * The code comes back in the response only when nothing was really sent -
 * otherwise the message is the delivery, and returning it here would defeat
 * the point of sending it.
 */
export async function issueOtp({ userId = null, destination, purpose, extra, phone = null }) {
  assertEmailDestination(destination);

  const recent = await queryOne(
    `SELECT created_at FROM otp_codes
      WHERE destination = $1 AND purpose = $2 AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [destination, purpose],
  );

  if (recent) {
    const elapsed = (Date.now() - new Date(recent.created_at).getTime()) / 1000;
    if (elapsed < RESEND_COOLDOWN_SECONDS) {
      throw ApiError.tooMany(
        'Please wait ' + Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed) +
          ' seconds before requesting another code',
      );
    }
  }

  // Any earlier unconsumed code for this destination is void once a new one
  // is sent, so two live codes can never both work.
  await query(
    `UPDATE otp_codes SET consumed_at = NOW()
      WHERE destination = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [destination, purpose],
  );

  const code = numericOtp(6);
  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60 * 1000);

  await query(
    `INSERT INTO otp_codes (user_id, destination, purpose, code_hash, expires_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [userId, destination, purpose, await bcrypt.hash(code, 8), expiresAt],
  );

  const delivery = await deliver({
    userId,
    email: destination,
    phone,
    purpose,
    code,
    extra,
    prefer: env.OTP_CHANNEL,
  });

  return { expiresAt, ...delivery };
}

/** Verifies and consumes a code. A consumed code can never be reused. */
export async function verifyOtp({ destination, purpose, code }) {
  const row = await queryOne(
    `SELECT id, user_id, code_hash, attempts, max_attempts, expires_at
       FROM otp_codes
      WHERE destination = $1 AND purpose = $2 AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [destination, purpose],
  );

  if (!row) throw ApiError.badRequest('No verification code is pending. Request a new one.');

  if (new Date(row.expires_at) < new Date()) {
    await query(`UPDATE otp_codes SET consumed_at = NOW() WHERE id = $1`, [row.id]);
    throw ApiError.badRequest('This code has expired. Request a new one.');
  }

  if (row.attempts >= row.max_attempts) {
    await query(`UPDATE otp_codes SET consumed_at = NOW() WHERE id = $1`, [row.id]);
    throw ApiError.tooMany('Too many incorrect attempts. Request a new code.');
  }

  const valid = await bcrypt.compare(code, row.code_hash);

  if (!valid) {
    await query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
    const left = row.max_attempts - row.attempts - 1;
    throw ApiError.badRequest(
      left > 0
        ? 'Incorrect code. ' + left + ' attempt(s) remaining.'
        : 'Incorrect code. No attempts remaining.',
    );
  }

  await query(`UPDATE otp_codes SET consumed_at = NOW() WHERE id = $1`, [row.id]);
  return { userId: row.user_id };
}

export default { issueOtp, verifyOtp, assertEmailDestination, OTP_PURPOSE };
