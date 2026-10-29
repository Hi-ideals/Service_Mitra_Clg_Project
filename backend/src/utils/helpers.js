import crypto from 'node:crypto';

/** Short, human-readable reference shown to users, e.g. BK-8F3K2Q. */
export function reference(prefix) {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let out = '';
  for (let i = 0; i < 6; i += 1) out += alphabet[crypto.randomInt(alphabet.length)];
  return `${prefix}-${out}`;
}

/** Numeric one-time password for phone/email confirmation and job completion. */
export function numericOtp(length = 6) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += crypto.randomInt(10);
  return out;
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/** Money is handled in paise/cents as integers - never as floats. */
export const money = {
  toMinor: (major) => Math.round(Number(major) * 100),
  toMajor: (minor) => Number((Number(minor) / 100).toFixed(2)),
  format: (minor) => `INR ${(Number(minor) / 100).toFixed(2)}`,
};

/** Great-circle distance in kilometres, used before the geo index is warm. */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Strips undefined keys so partial updates do not overwrite columns with null. */
export function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/**
 * Formats a calendar date as YYYY-MM-DD in local terms.
 *
 * PostgreSQL returns a DATE column as a Date at LOCAL midnight. Calling
 * toISOString() on that converts to UTC, which in any timezone ahead of UTC
 * (IST, for one) rolls the date back a day - so a provider blocking the 22nd
 * would have the 21st greyed out instead. Always use this, never toISOString,
 * for anything the user thinks of as a calendar date.
 */
export function dateKey(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + month + '-' + day;
}

export default { reference, numericOtp, sha256, money, haversineKm, compact, dateKey };
