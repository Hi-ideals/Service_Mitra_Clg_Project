/**
 * Phone numbers in the form WhatsApp expects.
 *
 * The application stores Indian mobile numbers as ten digits, which is what
 * customers type and what the validation enforces. Meta's API wants E.164
 * without the plus - 919876543210 - and silently accepts a malformed number,
 * reporting success while delivering nothing. So conversion happens in one
 * place, with the failure cases returning null rather than a guess.
 */

/** The default when a number carries no country code of its own. */
const DEFAULT_COUNTRY_CODE = '91';

/**
 * Converts a stored number to the digits-only international form.
 *
 * Returns null when the input cannot be a real mobile number, so the caller
 * can fall back to another channel instead of sending into the void.
 */
export function toE164(raw, countryCode = DEFAULT_COUNTRY_CODE) {
  if (!raw) return null;

  // Strip everything a human might type: +91, spaces, hyphens, brackets.
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;

  // 00 is the international prefix in much of the world, and a single leading
  // 0 is India's trunk prefix - people write both. Either way what follows is
  // the number itself, so the prefix is dropped before anything else is read.
  let trimmed = digits;
  if (trimmed.startsWith('00')) trimmed = trimmed.slice(2);
  else if (trimmed.startsWith('0')) trimmed = trimmed.slice(1);

  // Ten digits starting 6-9 is an Indian mobile with the code omitted.
  if (/^[6-9]\d{9}$/.test(trimmed)) return countryCode + trimmed;

  // Already carries the country code.
  if (trimmed.startsWith(countryCode) && /^[6-9]\d{9}$/.test(trimmed.slice(countryCode.length))) {
    return trimmed;
  }

  // Some other country's number. Accepted on length alone, because validating
  // every national numbering plan is a library's job, not this file's.
  if (trimmed.length >= 10 && trimmed.length <= 15) return trimmed;

  return null;
}

/**
 * A number safe to show in a log or a confirmation message.
 *
 * "Sent to +91 ****** 3239" tells the right person they have the right
 * number while telling anyone reading over their shoulder nothing useful.
 */
export function maskPhone(raw) {
  const e164 = toE164(raw);
  if (!e164) return 'your number';

  const last4 = e164.slice(-4);
  return '+' + e164.slice(0, e164.length - 4).replace(/\d/g, '*') + last4;
}

export default { toE164, maskPhone };
