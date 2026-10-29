/**
 * Server backups.
 *
 * A real one: `pg_dump` of the whole database, gzipped, plus a tar of the
 * uploads directory - which holds the KYC documents, and which no database
 * dump covers. Together those two files can rebuild this platform on a bare
 * server. Separately, neither can.
 *
 * Three things here are deliberate.
 *
 * The password goes to pg_dump through PGPASSWORD in its environment, never
 * as an argument. Arguments are readable by every process on the host through
 * /proc/<pid>/cmdline; an environment variable is not.
 *
 * Arguments are passed as an array, so nothing here is ever parsed by a shell.
 * A database name with a space in it is an argument, not a second command.
 *
 * Every file is written to `.part` and renamed only after the process exits
 * zero. A backup that looks complete but is truncated is worse than a missing
 * one, because it is the one you reach for at the worst possible moment.
 */
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import env from '../config/env.js';
import logger from '../config/logger.js';
import ApiError from '../utils/ApiError.js';
import { queryOne } from '../db/pool.js';

const ROOT = path.resolve(env.BACKUP_DIR);
const UPLOADS = path.resolve(env.UPLOAD_DIR);

/**
 * How long a single pg_dump or tar may take before it is killed.
 *
 * Generous, because a large database on a slow disk is not a fault. The point
 * is that a child which hangs forever must not hold the lock below forever
 * with it, leaving a server that silently never backs up again.
 */
const TIMEOUT_MS = 30 * 60_000;

/**
 * Backups must not live inside the uploads directory.
 *
 * Everything under UPLOAD_DIR is reachable through the storage service. Those
 * routes are private and signed, but a full database dump - every password
 * hash, every bank detail - has no business being addressable by them at all,
 * and a backup of the uploads folder that contains the previous backups grows
 * without bound besides.
 */
function assertNotInsideUploads() {
  if (ROOT === UPLOADS || ROOT.startsWith(UPLOADS + path.sep)) {
    throw new Error(
      'BACKUP_DIR (' + ROOT + ') is inside UPLOAD_DIR (' + UPLOADS + '). ' +
      'Move it somewhere the storage service does not serve.',
    );
  }
}

/**
 * The only shape a backup file may have.
 *
 * Used both to name new files and to validate a requested one on the way back
 * out, so a download can never address anything this module did not create.
 */
const FILENAME = /^servicemitra-(\d{4}-\d{2}-\d{2}-\d{4})-(database\.sql\.gz|files\.tar\.gz)$/;

const KINDS = {
  'database.sql.gz': { kind: 'database', label: 'Database', type: 'application/gzip' },
  'files.tar.gz': { kind: 'files', label: 'Uploaded documents', type: 'application/gzip' },
};

/** `2026-10-13-1432` - sorts chronologically as a string, which is why it is used as the group key. */
function stamp(at = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return [
    at.getFullYear(), '-', p(at.getMonth() + 1), '-', p(at.getDate()),
    '-', p(at.getHours()), p(at.getMinutes()),
  ].join('');
}

async function ensureRoot() {
  await fs.mkdir(ROOT, { recursive: true });
}

/**
 * Runs a command with no shell, and resolves only on a zero exit.
 *
 * `onStdout` receives the stream for the callers that pipe it somewhere. The
 * output is never buffered into memory - a database dump does not fit there.
 */
function run(command, args, { onStdout, env: extraEnv, timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        env: { ...process.env, ...extraEnv },
        windowsHide: true,
      });
    } catch (err) {
      reject(err);
      return;
    }

    // Bounded: a tool that fails in a loop must not be able to grow this
    // string until the process runs out of memory.
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 4000) stderr += chunk.toString('utf8');
    });

    // Both pipes must be consumed. An unread pipe fills its OS buffer, the
    // child blocks writing to it, and `close` never arrives - so the promise
    // never settles and whoever awaited it waits forever.
    let stdoutDone = Promise.resolve();
    if (onStdout) stdoutDone = onStdout(child.stdout);
    else child.stdout.resume();

    // A hung child would otherwise hold the backup lock for the lifetime of
    // the process, which means no backup ever runs again until a restart.
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    timer.unref?.();
    let timedOut = false;

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      stdoutDone.then(
        () => {
          if (timedOut) {
            reject(new Error(command + ' took longer than ' + Math.round(timeoutMs / 1000) + 's and was stopped'));
          } else if (code === 0) {
            resolve(stderr);
          } else {
            reject(new Error(command + ' exited ' + code + (stderr ? ': ' + stderr.trim() : '')));
          }
        },
        reject,
      );
    });
  });
}

/**
 * Whether the tools exist, and whether pg_dump is new enough for this server.
 *
 * The version check is not pedantry. pg_dump refuses outright to dump a server
 * newer than itself, and the failure arrives as an opaque message at the
 * moment somebody needs a backup. Finding it here means the screen can say so
 * while there is still time to fix it.
 */
let toolCache = null;

export async function toolStatus() {
  // Spawning two processes on every page load is wasteful, and the answer
  // changes only when the server is rebuilt. A minute is short enough that a
  // fix is visible almost immediately and long enough that refreshing the
  // page cannot be used to spawn processes in a loop.
  if (toolCache && Date.now() - toolCache.at < 60_000) return toolCache.value;

  const status = { pgDump: null, serverVersion: null, tar: null, ok: false, problem: null };

  try {
    const out = await capture(env.PG_DUMP_PATH, ['--version']);
    status.pgDump = out.trim().replace(/^pg_dump\s*\(PostgreSQL\)\s*/i, '');
  } catch (err) {
    status.problem = 'pg_dump is not installed on this server (' + (err.code ?? err.message) + ')';
  }

  try {
    const row = await queryOne('SHOW server_version');
    status.serverVersion = row?.server_version ?? null;
  } catch {
    // The status screen is still useful without it.
  }

  try {
    status.tar = (await capture(env.TAR_PATH, ['--version'])).split('\n')[0].trim();
  } catch {
    status.tar = null;
  }

  const clientMajor = Number.parseInt(status.pgDump ?? '', 10);
  const serverMajor = Number.parseInt(status.serverVersion ?? '', 10);
  if (clientMajor && serverMajor && clientMajor < serverMajor) {
    status.problem =
      'pg_dump ' + clientMajor + ' cannot back up a PostgreSQL ' + serverMajor + ' server. ' +
      'Install the matching client version.';
  }

  if (!status.problem) {
    try {
      assertNotInsideUploads();
    } catch (err) {
      status.problem = err.message;
    }
  }

  status.ok = Boolean(status.pgDump) && !status.problem;
  toolCache = { at: Date.now(), value: status };
  return status;
}

/**
 * Runs a command purely for its output. Only used for `--version`.
 *
 * Short timeout and a drained stderr, because this one runs on an ordinary
 * page load: a tool that blocks on a full stderr pipe would hang the admin
 * backup screen rather than merely failing it.
 */
function capture(command, args) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { windowsHide: true });
    } catch (err) {
      reject(err);
      return;
    }

    let out = '';
    child.stdout.on('data', (c) => { if (out.length < 500) out += c.toString('utf8'); });
    child.stderr.resume();

    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    timer.unref?.();

    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      return code === 0 ? resolve(out) : reject(new Error('exited ' + code));
    });
  });
}

/** The whole database, gzipped. */
async function dumpDatabase(target) {
  const args = [
    '--host', String(env.DB_HOST),
    '--port', String(env.DB_PORT),
    '--username', String(env.DB_USER),
    '--dbname', String(env.DB_NAME),
    // Restorable into a database owned by whoever runs the restore, rather
    // than one that must already have the same roles as this server.
    '--no-owner',
    '--no-privileges',
    // Drops what it is about to recreate, so restoring over a half-built
    // database does not fail halfway through on objects that already exist.
    '--clean',
    '--if-exists',
  ];

  const part = target + '.part';
  await run(env.PG_DUMP_PATH, args, {
    env: { PGPASSWORD: String(env.DB_PASSWORD) },
    onStdout: (stdout) => pipeline(stdout, zlib.createGzip({ level: 6 }), createWriteStream(part)),
  });

  // A dump of an empty or unreachable database still gzips to a valid file of
  // a few dozen bytes. Nothing this schema produces is that small, so a file
  // that size means the dump did not happen, whatever the exit code said.
  const { size } = await fs.stat(part);
  if (size < 1024) {
    await fs.rm(part, { force: true });
    throw new Error('pg_dump produced an empty file');
  }

  await fs.rename(part, target);
  return size;
}

/** The uploads directory, tarred. Holds the KYC documents. */
async function archiveUploads(target) {
  const uploads = path.resolve(env.UPLOAD_DIR);

  try {
    await fs.access(uploads);
  } catch {
    return null; // Nothing uploaded yet on this server.
  }

  const part = target + '.part';
  // Two things here are deliberate.
  //
  // `-C parent base` so the archive contains `uploads/...` rather than the
  // absolute path of this particular machine - an archive that only unpacks
  // onto the same directory layout is a trap.
  //
  // `-f -`, writing to stdout for Node to put where it belongs, rather than
  // naming the output file. GNU tar reads an argument containing a colon as
  // `host:path` and tries to open a network connection, so `-f E:/...` fails
  // on a Windows development machine with a message about resolving a host.
  await run(env.TAR_PATH, [
    '-czf', '-',
    '-C', path.dirname(uploads),
    path.basename(uploads),
  ], {
    onStdout: (stdout) => pipeline(stdout, createWriteStream(part)),
  });

  const { size } = await fs.stat(part);
  await fs.rename(part, target);
  return size;
}

/**
 * Takes a backup.
 *
 * The uploads archive is best-effort: if `tar` is missing the database is
 * still worth having, and the result says plainly what it did not include
 * rather than reporting a success that is half a backup.
 */
let inFlight = null;

export function runBackup(options = {}) {
  /**
   * One backup at a time, process-wide.
   *
   * The scheduler guards a job against itself, but nothing stopped the hourly
   * job and the admin's "Back up now" button overlapping - and two runs that
   * start in the same minute derive the same filename, so both would write the
   * same `.part` file and one would rename a half-written dump into place.
   *
   * A second caller joins the run already going rather than being refused: a
   * backup genuinely is being taken, and that is what they asked for.
   */
  if (inFlight) return inFlight.then((result) => ({ ...result, joined: true }));

  inFlight = execute(options).finally(() => { inFlight = null; });
  return inFlight;
}

/**
 * Free space where the backups go, in bytes, or null if it cannot be read.
 */
export async function freeSpace() {
  try {
    const info = await fs.statfs(ROOT);
    return info.bavail * info.bsize;
  } catch {
    return null;
  }
}

/**
 * Refuses to start a backup that would fill the disk.
 *
 * This server is shared with other applications. A backup that runs the disk
 * to zero does not merely fail - it takes down everything else on the machine,
 * including the database it was trying to protect. Refusing early, with a
 * message naming the numbers, is the only outcome here worth having.
 *
 * The estimate is the size of the newest existing run, because that is the
 * best available predictor of the next one, doubled for the headroom the dump
 * needs before `prune` removes anything.
 */
async function assertRoomToWrite() {
  const free = await freeSpace();
  if (free === null) return; // Unknown on this platform; not a reason to refuse.

  const runs = await list();
  const newest = runs.length ? runs[0].group : null;
  const lastRun = runs.filter((f) => f.group === newest).reduce((sum, f) => sum + f.bytes, 0);

  // 1 GB floor for the first backup, when there is nothing to estimate from.
  const needed = Math.max(lastRun * 2, 1024 ** 3);
  if (free < needed) {
    const gb = (n) => (n / 1024 ** 3).toFixed(1) + ' GB';
    throw new Error(
      'Not enough disk space: ' + gb(free) + ' free, about ' + gb(needed) + ' needed. ' +
      'Free some space or lower BACKUP_KEEP.',
    );
  }
}

async function execute({ trigger = 'scheduled' } = {}) {
  assertNotInsideUploads();
  await ensureRoot();
  await assertRoomToWrite();

  const group = stamp();
  const started = Date.now();
  const files = [];

  const database = path.join(ROOT, 'servicemitra-' + group + '-database.sql.gz');
  let bytes;
  try {
    bytes = await dumpDatabase(database);
  } catch (err) {
    // A failed dump can leave a part-file the size of the database. The
    // sweep in `prune` would get it within the hour; not leaving it at all is
    // better on a disk that may be why the dump failed.
    await fs.rm(database + '.part', { force: true });
    throw err;
  }
  files.push({ name: path.basename(database), kind: 'database', bytes });

  let uploadsError = null;
  if (env.BACKUP_INCLUDE_UPLOADS) {
    const archive = path.join(ROOT, 'servicemitra-' + group + '-files.tar.gz');
    try {
      const size = await archiveUploads(archive);
      if (size !== null) files.push({ name: path.basename(archive), kind: 'files', bytes: size });
    } catch (err) {
      uploadsError = err.message;
      logger.error({ err }, 'Database backed up, but the uploads archive failed');
      await fs.rm(archive + '.part', { force: true });
    }
  }

  const pruned = await prune();

  logger.info(
    { trigger, group, files: files.length, ms: Date.now() - started, pruned },
    'Backup complete',
  );

  return { group, files, pruned, uploadsError, joined: false, ms: Date.now() - started };
}

/**
 * Deletes all but the newest `BACKUP_KEEP` runs.
 *
 * Whole runs, not whole files: a database dump kept without the matching
 * uploads archive restores to a platform whose documents all 404.
 */
export async function prune() {
  const entries = await list();
  const groups = [...new Set(entries.map((f) => f.group))].sort().reverse();
  const doomed = groups.slice(Math.max(1, env.BACKUP_KEEP));

  let removed = 0;
  for (const file of entries) {
    if (!doomed.includes(file.group)) continue;
    await fs.rm(path.join(ROOT, file.name), { force: true });
    removed += 1;
  }

  // Abandoned part-files from a crash or a failed run. Nothing reads them and
  // they are as large as the backup that failed.
  const hourAgo = Date.now() - 3600_000;
  for (const name of await readdir()) {
    if (!name.endsWith('.part')) continue;
    const full = path.join(ROOT, name);
    const info = await fs.stat(full).catch(() => null);
    if (info && info.mtimeMs < hourAgo) {
      await fs.rm(full, { force: true });
      removed += 1;
    }
  }

  return removed;
}

async function readdir() {
  try {
    return await fs.readdir(ROOT);
  } catch {
    return [];
  }
}

/** Every backup file on disk, newest first. The directory is the source of truth. */
export async function list() {
  const out = [];

  for (const name of await readdir()) {
    const match = FILENAME.exec(name);
    if (!match) continue;

    const info = await fs.stat(path.join(ROOT, name)).catch(() => null);
    if (!info) continue;

    out.push({
      name,
      group: match[1],
      ...KINDS[match[2]],
      bytes: info.size,
      createdAt: info.mtime.toISOString(),
    });
  }

  return out.sort((a, b) => b.group.localeCompare(a.group) || a.kind.localeCompare(b.kind));
}

/** What the admin screen shows: the runs, grouped, with their total size. */
export async function status() {
  const files = await list();
  const tools = await toolStatus();

  const runs = [];
  for (const file of files) {
    let run = runs.find((r) => r.group === file.group);
    if (!run) {
      run = { group: file.group, takenAt: file.createdAt, files: [], bytes: 0 };
      runs.push(run);
    }
    run.files.push(file);
    run.bytes += file.bytes;
  }

  return {
    tools,
    runs,
    totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
    lastBackupAt: runs[0]?.takenAt ?? null,
    schedule: {
      everyHours: env.BACKUP_EVERY_HOURS,
      keep: env.BACKUP_KEEP,
      includesUploads: env.BACKUP_INCLUDE_UPLOADS,
      enabled: env.BACKUP_EVERY_HOURS > 0,
    },
  };
}

/**
 * Turns a requested filename into a path, or refuses.
 *
 * Two independent checks, because this is the one place an admin-supplied
 * string becomes a filesystem path: the name must match the pattern this
 * module writes, and the resolved path must still be inside the backup
 * directory afterwards. Either alone would be enough; both is what makes a
 * mistake in one of them survivable.
 */
export async function fileFor(name) {
  if (!FILENAME.test(name)) throw ApiError.notFound('No such backup');

  const full = path.resolve(ROOT, name);
  if (!full.startsWith(ROOT + path.sep)) throw ApiError.badRequest('Invalid backup name');

  const info = await fs.stat(full).catch(() => null);
  if (!info?.isFile()) throw ApiError.notFound('No such backup');

  return { path: full, bytes: info.size, type: 'application/gzip' };
}

/**
 * Whether a scheduled run is due.
 *
 * The scheduler runs this on boot as well as on its interval, so that a server
 * restarted every day still gets backed up. This is what stops that becoming a
 * backup on every deploy: if a recent one already exists, there is nothing to
 * do.
 */
export async function isDue() {
  if (env.BACKUP_EVERY_HOURS <= 0) return false;

  const runs = await list();
  if (runs.length === 0) return true;

  const newest = Math.max(...runs.map((f) => new Date(f.createdAt).getTime()));
  // 90%, so a run that starts a minute late does not push the next one a whole
  // interval away and slowly drift to backing up every two days.
  return Date.now() - newest >= env.BACKUP_EVERY_HOURS * 3600_000 * 0.9;
}

export default { runBackup, list, status, fileFor, prune, isDue, toolStatus, freeSpace };
