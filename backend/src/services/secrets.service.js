/**
 * Credentials that live in the database, encrypted.
 *
 * Settings are ordinary JSON and belong in `platform_settings`. A password is
 * not an ordinary setting: that table is dumped into every backup, and a
 * backup can be downloaded from the admin console in one click. A mail
 * password sitting there in plain text would travel in each one, and whoever
 * ends up holding a backup file would hold working credentials for sending
 * mail from this domain - which is to say, for sending password resets.
 *
 * So anything secret goes through here on the way in and on the way out. The
 * key lives in the environment, never in the database, so a dump on its own
 * decrypts to nothing.
 *
 * ---
 *
 * The key material is `TOTP_ENCRYPTION_KEY`, with a separate key derived per
 * purpose rather than the same bytes used twice. Two consequences worth
 * knowing:
 *
 * - Ciphertext from one purpose cannot be decrypted by another, so a flaw in
 *   one does not spread.
 * - But they share one configured value, so rotating it invalidates both at
 *   once - every enrolled authenticator AND the stored mail password. If you
 *   ever need to rotate one without the other, split this onto its own
 *   variable first.
 */
import crypto from 'node:crypto';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';

/**
 * A distinct 32-byte key per purpose.
 *
 * HMAC with the purpose as the message is the cheap, standard way to get
 * independent keys from one secret - the same idea as HKDF's expand step.
 */
function keyFor(purpose) {
  const master = env.TOTP_ENCRYPTION_KEY;
  if (!master) {
    throw new ApiError(503, 'This server cannot store credentials: TOTP_ENCRYPTION_KEY is not set.', {
      code: 'ENCRYPTION_NOT_CONFIGURED',
    });
  }

  return crypto.createHmac('sha256', master).update('servicemitra:' + purpose).digest();
}

/** Whether secrets can be stored at all. The settings screen asks before offering to. */
export function isConfigured() {
  return Boolean(env.TOTP_ENCRYPTION_KEY);
}

/**
 * AES-256-GCM. The authentication tag is what makes a tampered value fail
 * loudly rather than decrypt into rubbish that gets used as a password.
 */
export function encrypt(plain, purpose) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(purpose), iv);
  const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);

  return [
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    body.toString('base64'),
  ].join('.');
}

export function decrypt(stored, purpose) {
  const [iv, tag, body] = String(stored).split('.');
  if (!iv || !tag || !body) throw new Error('Stored credential is malformed');

  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(purpose), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));

  return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
}

export default { encrypt, decrypt, isConfigured };
