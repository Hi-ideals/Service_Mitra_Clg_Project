/**
 * Time-based one-time passwords (RFC 6238), and the encryption around them.
 *
 * Written against the specification rather than pulled from a package. The
 * algorithm is a HMAC, a truncation and a modulo - about thirty lines - and it
 * sits on the path that decides who may sign in as an administrator. A
 * dependency there is a dependency that can be taken over; this one can be
 * read in full in a couple of minutes and is checked against the test vectors
 * published in the RFC itself.
 *
 * SHA-1 is not a mistake. RFC 6238 specifies HMAC-SHA1 for the default
 * profile, and every authenticator app implements that profile; the known
 * weaknesses in SHA-1 are collision attacks, which have no bearing on HMAC
 * used as a short-lived pseudorandom function.
 */
import crypto from 'node:crypto';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';

const STEP_SECONDS = 30;
const DIGITS = 6;

/**
 * How far either side of now a code is accepted.
 *
 * One step - thirty seconds back and forward. Enough for a phone clock that
 * drifts a little and for the seconds a person spends typing, without turning
 * a sixty-second window into a five-minute one.
 */
const WINDOW = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, unpadded - what authenticator apps expect to be given. */
export function toBase32(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(input) {
  const clean = String(input).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];

  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(out);
}

/** A new secret. 20 bytes is the RFC 4226 recommendation and what apps expect. */
export function generateSecret() {
  return toBase32(crypto.randomBytes(20));
}

/** The counter value for a moment in time. */
export function stepFor(at = Date.now()) {
  return Math.floor(at / 1000 / STEP_SECONDS);
}

/**
 * HOTP (RFC 4226), which TOTP is defined in terms of.
 *
 * `digits` is a parameter only so the RFC 6238 test vectors - which are
 * eight digits long - can be checked against this exact code. Everything in
 * the application uses the default six.
 */
export function codeFor(secret, step, digits = DIGITS) {
  const key = typeof secret === 'string' ? fromBase32(secret) : secret;

  const counter = Buffer.alloc(8);
  // Big-endian 64-bit. writeBigUInt64BE rather than two 32-bit writes so the
  // high word is not silently dropped in some future year.
  counter.writeBigUInt64BE(BigInt(step));

  const digest = crypto.createHmac('sha1', key).update(counter).digest();

  // Dynamic truncation: the low nibble of the last byte picks where to read
  // four bytes from, and the top bit is masked off so the result is positive
  // on platforms that treat it as signed.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * Checks a code, and says which step matched.
 *
 * The step is returned rather than a bare true so the caller can record it and
 * refuse the same code a second time. `after` is that recorded step: anything
 * at or before it has been used already.
 *
 * Compared with timingSafeEqual. The comparison is against a value derived
 * from a secret, and a byte-by-byte early exit leaks how much of a guess was
 * right.
 */
export function verify(secret, code, { at = Date.now(), after = null } = {}) {
  const candidate = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(candidate)) return null;

  const now = stepFor(at);

  for (let drift = -WINDOW; drift <= WINDOW; drift += 1) {
    const step = now + drift;
    if (after !== null && step <= after) continue;

    const expected = Buffer.from(codeFor(secret, step), 'utf8');
    const given = Buffer.from(candidate, 'utf8');
    if (expected.length === given.length && crypto.timingSafeEqual(expected, given)) {
      return step;
    }
  }

  return null;
}

/**
 * The URI an authenticator app reads out of the QR code.
 *
 * The label carries the account so a person with several entries can tell them
 * apart, and the issuer makes the app group them under the product name.
 */
/**
 * The issuer an authenticator app groups entries under.
 *
 * Carries the environment outside production, because the same admin enrols
 * once per database - once on a laptop, once on the server - and two entries
 * reading "ServiceMitra: admin@..." are indistinguishable in the app. Reading
 * the wrong one gives a code that will never work, with nothing on screen to
 * explain why.
 */
const ISSUER = env.isProd ? 'ServiceMitra' : 'ServiceMitra (' + env.NODE_ENV + ')';

export function otpauthUri({ secret, account, issuer = ISSUER }) {
  const label = encodeURIComponent(issuer) + ':' + encodeURIComponent(account);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return 'otpauth://totp/' + label + '?' + params.toString();
}

// ---------------------------------------------------------------- at rest

/**
 * The key the secrets are encrypted with.
 *
 * Deliberately not JWT_ACCESS_SECRET. The audit already flagged reusing that
 * one for file signing: a single compromised value should not unlock two
 * unrelated systems, and rotating it for one reason should not silently break
 * the other.
 */
function key() {
  const configured = env.TOTP_ENCRYPTION_KEY;
  if (!configured) {
    throw new ApiError(503, 'Two-factor authentication is not configured on this server. ' +
      'Set TOTP_ENCRYPTION_KEY and restart.', { code: 'TOTP_NOT_CONFIGURED' });
  }
  // A hash, so any length of configured value becomes the 32 bytes AES needs.
  return crypto.createHash('sha256').update(configured).digest();
}

/** Whether this server can store secrets at all. The setup screen asks first. */
export function isConfigured() {
  return Boolean(env.TOTP_ENCRYPTION_KEY);
}

/** AES-256-GCM. The tag is what makes a tampered ciphertext fail rather than decode to rubbish. */
export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
}

export function decryptSecret(stored) {
  const [iv, tag, payload] = String(stored).split('.');
  if (!iv || !tag || !payload) throw new Error('Stored TOTP secret is malformed');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(payload, 'base64')), decipher.final()]).toString('utf8');
}

// ------------------------------------------------------------ recovery codes

/**
 * Ten single-use codes, shown once.
 *
 * Grouped as two blocks of five because they are meant to be written down or
 * printed, and an unbroken ten-character string is read back wrong. Drawn from
 * the same alphabet as the secret, which has no 0/O or 1/I to confuse.
 */
export function generateRecoveryCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i += 1) {
    const raw = toBase32(crypto.randomBytes(7)).slice(0, 10);
    codes.push(raw.slice(0, 5) + '-' + raw.slice(5));
  }
  return codes;
}

export const normaliseRecoveryCode = (code) =>
  String(code ?? '').toUpperCase().replace(/[^A-Z2-7]/g, '');

export const hashRecoveryCode = (code) =>
  crypto.createHash('sha256').update(normaliseRecoveryCode(code)).digest('hex');

export default {
  generateSecret, codeFor, verify, otpauthUri, stepFor,
  encryptSecret, decryptSecret, isConfigured,
  generateRecoveryCodes, hashRecoveryCode, normaliseRecoveryCode,
  toBase32, fromBase32,
};
