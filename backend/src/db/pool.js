/**
 * PostgreSQL connection pool - the only place in the app that holds
 * database credentials. Services reach the database through `query` and
 * `withTransaction`, never through a client directly.
 */
import pg from 'pg';
import env from '../config/env.js';
import logger from '../config/logger.js';

const { Pool, types } = pg;

// Return NUMERIC as a JS number rather than a string. Safe here because all
// money is stored as integer minor units, and numerics are bounded ratings.
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// Return BIGINT as a number - id ranges stay well inside Number.MAX_SAFE_INTEGER.
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

export const pool = new Pool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: env.DB_SSL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected error on idle PostgreSQL client');
});

/** Run a parameterised query. Slow queries are logged so they can be indexed away. */
export async function query(text, params = []) {
  const startedAt = Date.now();
  try {
    const result = await pool.query(text, params);
    const ms = Date.now() - startedAt;
    if (ms > 300) {
      logger.warn({ ms, sql: text.replace(/\s+/g, ' ').slice(0, 160) }, 'Slow query');
    }
    return result;
  } catch (err) {
    logger.error({ err, sql: text.replace(/\s+/g, ' ').slice(0, 300) }, 'Query failed');
    throw err;
  }
}

/** First row or null. */
export async function queryOne(text, params = []) {
  const { rows } = await query(text, params);
  return rows[0] ?? null;
}

/** All rows. */
export async function queryMany(text, params = []) {
  const { rows } = await query(text, params);
  return rows;
}

/**
 * Runs fn inside a transaction, passing it a client whose query has the same
 * signature as the module-level one. Anything that must agree with something
 * else - a booking and its payment, a refund and its ledger entry - goes here.
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx = {
      query: (text, params = []) => client.query(text, params),
      one: async (text, params = []) => (await client.query(text, params)).rows[0] ?? null,
      many: async (text, params = []) => (await client.query(text, params)).rows,
      client,
    };
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function healthcheck() {
  const startedAt = Date.now();
  const { rows } = await pool.query('SELECT 1 AS ok');
  return { ok: rows[0]?.ok === 1, latencyMs: Date.now() - startedAt };
}

export async function closePool() {
  await pool.end();
  logger.info('PostgreSQL pool closed');
}

export default { pool, query, queryOne, queryMany, withTransaction, healthcheck, closePool };
