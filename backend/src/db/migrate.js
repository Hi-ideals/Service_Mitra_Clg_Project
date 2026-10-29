/**
 * Minimal forward-only migration runner.
 *
 * Migrations are plain .sql files in ./migrations named NNN_description.sql.
 * A file may contain an optional "-- +down" marker; everything after it is the
 * rollback for that migration. Applied migrations are recorded in
 * schema_migrations with a checksum, so a file edited after being applied is
 * flagged rather than silently ignored.
 *
 *   npm run migrate          apply all pending
 *   npm run migrate:status   show applied and pending
 *   npm run migrate:down     roll back the most recent migration
 *   node src/db/migrate.js reset   roll everything back (development only)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';
import env from '../config/env.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

const TRACKING_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    checksum    TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const DOWN_MARKER = /^--\s*\+down\s*$/im;

function splitUpDown(sql) {
  const match = sql.match(DOWN_MARKER);
  if (!match) return { up: sql, down: null };
  const idx = sql.search(DOWN_MARKER);
  return { up: sql.slice(0, idx), down: sql.slice(idx + match[0].length) };
}

async function loadFiles() {
  await fs.mkdir(DIR, { recursive: true });
  const names = (await fs.readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
  return Promise.all(
    names.map(async (name) => {
      const sql = await fs.readFile(path.join(DIR, name), 'utf8');
      return {
        name,
        ...splitUpDown(sql),
        checksum: crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16),
      };
    }),
  );
}

async function appliedRows() {
  await pool.query(TRACKING_TABLE);
  const { rows } = await pool.query(
    'SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name',
  );
  return rows;
}

async function up() {
  const files = await loadFiles();
  const done = await appliedRows();
  const doneMap = new Map(done.map((r) => [r.name, r.checksum]));
  let count = 0;

  for (const f of files) {
    if (doneMap.has(f.name)) {
      if (doneMap.get(f.name) !== f.checksum) {
        console.warn('  !  ' + f.name + ' changed after being applied - review it manually');
      }
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(f.up);
      await client.query(
        'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)',
        [f.name, f.checksum],
      );
      await client.query('COMMIT');
      count += 1;
      console.log('  applied   ' + f.name);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('  FAILED    ' + f.name + '\n            ' + err.message);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log(count ? '\n' + count + ' migration(s) applied.' : '\nDatabase is already up to date.');
}

async function down(count = 1) {
  const files = await loadFiles();
  const fileMap = new Map(files.map((f) => [f.name, f]));
  const targets = (await appliedRows()).reverse().slice(0, count);

  if (!targets.length) {
    console.log('Nothing to roll back.');
    return;
  }

  for (const row of targets) {
    const f = fileMap.get(row.name);
    if (!f || !f.down) {
      console.error('  ' + row.name + ' has no "-- +down" section; stopping.');
      break;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(f.down);
      await client.query('DELETE FROM schema_migrations WHERE name = $1', [row.name]);
      await client.query('COMMIT');
      console.log('  reverted  ' + row.name);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('  FAILED reverting ' + row.name + ': ' + err.message);
      throw err;
    } finally {
      client.release();
    }
  }
}

async function status() {
  const files = await loadFiles();
  const done = new Map((await appliedRows()).map((r) => [r.name, r.applied_at]));
  console.log('\n  Migration status\n  ----------------');
  if (!files.length) console.log('  (no migration files yet)');
  for (const f of files) {
    const at = done.get(f.name);
    const when = at ? '  (' + new Date(at).toISOString() + ')' : '';
    console.log('  ' + (at ? 'applied  ' : 'pending  ') + f.name + when);
  }
  console.log('');
}

async function reset() {
  if (env.isProd) throw new Error('reset is disabled in production');
  const files = await loadFiles();
  await down(files.length);
}

const commands = { up, down: () => down(1), status, reset };
const cmd = process.argv[2] || 'up';
const run = commands[cmd];

if (!run) {
  console.error('Unknown command "' + cmd + '". Use one of: ' + Object.keys(commands).join(', '));
  process.exit(1);
}

run()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err.message);
    await pool.end().catch(() => {});
    process.exit(1);
  });
