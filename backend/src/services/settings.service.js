/**
 * Platform settings.
 *
 * The admin controls commission, payout schedule, cancellation policy and
 * booking timings at runtime. These are read on nearly every booking, so they
 * are cached in process with a short TTL and the cache is dropped whenever the
 * admin writes - stale commission would be a money bug, not a display bug.
 */
import { queryMany, queryOne } from '../db/pool.js';
import env from '../config/env.js';
import logger from '../config/logger.js';

const TTL_MS = 60_000;

let cache = null;
let cachedAt = 0;

/** Used when the database has no row yet - keeps the API working on a fresh install. */
const DEFAULTS = {
  commission: { defaultPercent: env.PLATFORM_COMMISSION_PERCENT },
  payout: { schedule: 'weekly', dayOfWeek: 1, minimumAmountMinor: 50000 },
  cancellation: { freeWindowHours: 12, lateFeePercent: 20, noShowFeePercent: 50 },
  booking: {
    acceptWindowMinutes: env.BOOKING_ACCEPT_WINDOW_MINUTES,
    disputeWindowHours: env.DISPUTE_WINDOW_HOURS,
    maxAdvanceDays: 30,
  },
  tax: { gstPercent: 18, inclusive: false },
};

export async function all({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cachedAt < TTL_MS) return cache;

  try {
    const rows = await queryMany('SELECT key, value FROM platform_settings');
    const loaded = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    cache = { ...DEFAULTS, ...loaded };
    cachedAt = Date.now();
  } catch (err) {
    logger.error({ err }, 'Could not load platform settings, using defaults');
    cache = DEFAULTS;
    cachedAt = Date.now();
  }

  return cache;
}

export async function get(key) {
  return (await all())[key] ?? DEFAULTS[key];
}

export async function update(key, value, adminId) {
  const row = await queryOne(
    `INSERT INTO platform_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value,
       updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING key, value, updated_at`,
    [key, JSON.stringify(value), adminId ?? null],
  );
  invalidate();
  return row;
}

export function invalidate() {
  cache = null;
  cachedAt = 0;
}

export default { all, get, update, invalidate, DEFAULTS };
