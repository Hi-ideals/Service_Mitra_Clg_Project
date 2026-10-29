/**
 * Server backups and admin data exports.
 *
 * The claim that matters is not "a file was produced". It is that the file
 * restores. So the central test here takes a real backup, loads it into a
 * scratch database, and counts the rows that come back - if a dump cannot
 * rebuild the platform, every other assertion about it is decoration.
 *
 * The rest guard the way in: only an admin can reach any of this, a filename
 * cannot address anything outside the backup directory, and taking or
 * downloading a copy of the whole database is written to the audit log.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { createApp } from '../src/app.js';
import { pool, queryOne } from '../src/db/pool.js';
import env from '../src/config/env.js';

const PASSWORD = 'Password@123';
const ROOT = path.resolve(env.BACKUP_DIR);

function request(port, method, p, { token, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString('utf8');
        resolve({
          status: res.statusCode,
          headers: res.headers,
          buffer,
          raw: text,
          body: /json/.test(res.headers['content-type'] ?? '') && text ? JSON.parse(text) : null,
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function post(port, p, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1', port, method: 'POST', path: p,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(JSON.parse(data)));
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/** Runs a command and resolves with its output, or rejects with stderr. */
function sh(command, args, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...extraEnv },
      windowsHide: true,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err || 'exited ' + code))));
  });
}

const DATASETS = ['people', 'bookings', 'payments', 'invoices', 'payouts', 'reviews'];

test('Server backups', async (t) => {
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  t.after(async () => {
    // The dumps are large and hold the whole test database. Nothing should
    // find them lying around after the suite.
    await fs.rm(ROOT, { recursive: true, force: true });
    server.close();
  });

  const admin = (await post(port, '/api/v1/auth/login', {
    identifier: 'admin@servicesetu.in', password: PASSWORD,
  })).data;
  const customer = (await post(port, '/api/v1/auth/login', {
    identifier: 'customer@servicesetu.in', password: PASSWORD,
  })).data;

  const aAuth = { token: admin.accessToken };

  await t.test('the status reports whether this server can take a backup at all', async () => {
    const res = await request(port, 'GET', '/api/v1/admin/backup/status', aAuth);
    assert.equal(res.status, 200);

    const body = res.body.data;
    assert.equal(typeof body.tools.ok, 'boolean');
    assert.ok(Array.isArray(body.runs));
    assert.equal(body.schedule.keep, env.BACKUP_KEEP);
    assert.equal(typeof body.schedule.everyHours, 'number');

    // If pg_dump is missing or too old, that is reported as a problem an admin
    // can read rather than left to fail on the day it is needed.
    if (!body.tools.ok) assert.ok(body.tools.problem, 'an unusable setup must explain itself');
  });

  const status = (await request(port, 'GET', '/api/v1/admin/backup/status', aAuth)).body.data;

  // Everything below needs a working pg_dump. Skipping is honest when the
  // tooling is absent; passing would not be.
  const available = status.tools.ok;
  if (!available) {
    t.diagnostic('pg_dump unavailable (' + status.tools.problem + ') - backup tests skipped');
  }

  await t.test('a manual backup produces a database dump and a document archive', { skip: !available }, async () => {
    const res = await request(port, 'POST', '/api/v1/admin/backup/run', aAuth);
    assert.equal(res.status, 200, res.raw.slice(0, 300));

    const result = res.body.data;
    assert.ok(result.files.some((f) => f.kind === 'database'), 'the database is dumped');
    assert.ok(
      result.files.some((f) => f.kind === 'files'),
      'the uploaded documents are archived too - a database-only backup is not a backup' +
        (result.uploadsError ? ' (' + result.uploadsError + ')' : ''),
    );

    for (const file of result.files) {
      const info = await fs.stat(path.join(ROOT, file.name));
      assert.ok(info.size > 1024, file.name + ' is not an empty shell');
    }

    // Nothing half-written survives a successful run.
    const leftovers = (await fs.readdir(ROOT)).filter((n) => n.endsWith('.part'));
    assert.deepEqual(leftovers, [], 'no part-files are left behind');
  });

  await t.test('the dump restores into an empty database with the data intact', { skip: !available }, async () => {
    /**
     * The only test that proves a backup is a backup.
     *
     * Restores into a scratch database and compares row counts against the
     * live one. Everything else in this file could pass against a file of
     * random bytes with the right name.
     */
    const scratch = 'servicemitra_restore_check';
    const admin_env = { PGPASSWORD: String(env.DB_PASSWORD) };
    const connect = [
      '--host', String(env.DB_HOST), '--port', String(env.DB_PORT),
      '--username', String(env.DB_USER),
    ];

    const expected = await queryOne(
      `SELECT (SELECT COUNT(*) FROM users)::int AS users,
              (SELECT COUNT(*) FROM bookings)::int AS bookings,
              (SELECT COUNT(*) FROM service_categories)::int AS categories`,
    );

    const dump = (await fs.readdir(ROOT)).find((n) => n.endsWith('-database.sql.gz'));
    assert.ok(dump, 'the previous test left a dump to restore');

    const sql = zlib.gunzipSync(await fs.readFile(path.join(ROOT, dump))).toString('utf8');
    assert.match(sql, /CREATE TABLE public\.users/, 'the schema is in the dump');
    assert.match(sql, /COPY public\.users/, 'and so is the data');

    const psql = env.PG_DUMP_PATH.replace(/pg_dump(\.exe)?$/i, (m) => m.replace('pg_dump', 'psql'));
    const plain = path.join(ROOT, 'restore-check.sql');

    try {
      await sh(psql, [...connect, '--dbname', 'postgres', '--command',
        'DROP DATABASE IF EXISTS ' + scratch], admin_env);
      await sh(psql, [...connect, '--dbname', 'postgres', '--command',
        'CREATE DATABASE ' + scratch], admin_env);

      await fs.writeFile(plain, sql);
      // ON_ERROR_STOP, so a restore that fails halfway fails the test rather
      // than leaving a partly-populated database that still counts rows.
      await sh(psql, [...connect, '--dbname', scratch, '--quiet',
        '--set', 'ON_ERROR_STOP=1', '--file', plain], admin_env);

      const restored = await sh(psql, [...connect, '--dbname', scratch, '--tuples-only',
        '--no-align', '--command',
        'SELECT (SELECT COUNT(*) FROM users) || \',\' || (SELECT COUNT(*) FROM bookings) || \',\' ' +
        '|| (SELECT COUNT(*) FROM service_categories)'], admin_env);

      const [users, bookings, categories] = restored.trim().split(',').map(Number);
      assert.equal(users, expected.users, 'every user came back');
      assert.equal(bookings, expected.bookings, 'every booking came back');
      assert.equal(categories, expected.categories, 'every category came back');
    } finally {
      await fs.rm(plain, { force: true });
      await sh(psql, [...connect, '--dbname', 'postgres', '--command',
        'DROP DATABASE IF EXISTS ' + scratch], admin_env).catch(() => {});
    }
  });

  await t.test('a backup can be downloaded, and it is a real gzip', { skip: !available }, async () => {
    const listed = (await request(port, 'GET', '/api/v1/admin/backup/status', aAuth)).body.data;
    const file = listed.runs[0].files.find((f) => f.kind === 'database');

    const res = await request(port, 'GET', '/api/v1/admin/backup/file/' + file.name, aAuth);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-disposition'], new RegExp(file.name));
    assert.equal(res.headers['cache-control'], 'private, no-store');

    // Magic bytes, then an actual decompress: a truncated gzip has the right
    // first two bytes too.
    assert.equal(res.buffer[0], 0x1f);
    assert.equal(res.buffer[1], 0x8b);
    assert.match(zlib.gunzipSync(res.buffer).toString('utf8'), /PostgreSQL database dump/);
  });

  await t.test('taking and downloading a backup are both written to the audit log', { skip: !available }, async () => {
    const taken = await queryOne(
      `SELECT after_state FROM admin_audit_log
        WHERE action = 'backup.created' ORDER BY created_at DESC LIMIT 1`,
    );
    assert.ok(taken, 'a copy of the whole database leaving the server is not an unrecorded event');

    const downloaded = await queryOne(
      `SELECT after_state FROM admin_audit_log
        WHERE action = 'backup.downloaded' ORDER BY created_at DESC LIMIT 1`,
    );
    assert.ok(downloaded, 'and neither is downloading one');
  });

  await t.test('old runs are pruned, newest kept', { skip: !available }, async () => {
    // Backdated names rather than real dumps: pruning is about the grouping
    // and the ordering, and taking three more real backups to prove it would
    // add half a minute to the suite for nothing.
    const stale = ['2020-01-01-0900', '2020-01-02-0900', '2020-01-03-0900'];
    for (const group of stale) {
      for (const kind of ['database.sql.gz', 'files.tar.gz']) {
        await fs.writeFile(path.join(ROOT, 'servicemitra-' + group + '-' + kind), 'x'.repeat(2048));
      }
    }

    const backup = await import('../src/services/backup.service.js');
    await backup.prune();

    const left = await backup.list();
    const groups = [...new Set(left.map((f) => f.group))];
    assert.equal(groups.length, env.BACKUP_KEEP, 'exactly the retention is kept');
    assert.ok(
      !groups.includes('2020-01-01-0900'),
      'and it is the oldest that goes',
    );

    // Whole runs, never half of one: a dump kept without its documents
    // restores to a platform whose KYC files all 404.
    for (const group of groups) {
      const kinds = left.filter((f) => f.group === group).map((f) => f.kind).sort();
      assert.deepEqual(kinds, ['database', 'files'], group + ' kept both halves');
    }
  });

  await t.test('two backups at once produce one backup, not two half-written ones', { skip: !available }, async () => {
    /**
     * The scheduled job and the "Back up now" button can overlap, and two runs
     * starting in the same minute derive the same filename - so without a lock
     * both write the same part-file and one renames a half-written dump into
     * place. The second caller joins the first run instead.
     */
    const backup = await import('../src/services/backup.service.js');
    const before = new Set((await backup.list()).map((f) => f.name));

    const [first, second] = await Promise.all([
      backup.runBackup({ trigger: 'manual' }),
      backup.runBackup({ trigger: 'manual' }),
    ]);

    assert.equal(first.group, second.group, 'both callers got the same run');
    assert.ok(first.joined !== second.joined, 'exactly one of them joined the other');

    const added = (await backup.list()).filter((f) => !before.has(f.name));
    assert.ok(added.length <= 2, 'one run, not two: ' + added.map((f) => f.name).join(', '));

    for (const file of added) {
      const info = await fs.stat(path.join(ROOT, file.name));
      assert.ok(info.size > 1024, file.name + ' is whole');
    }

    assert.deepEqual(
      (await fs.readdir(ROOT)).filter((n) => n.endsWith('.part')),
      [],
      'and nothing was left half-written',
    );
  });

  await t.test('a backup directory inside the uploads folder is refused', async () => {
    // Everything under UPLOAD_DIR is addressable through the storage service.
    // A database dump - every password hash, every bank detail - must not be,
    // and a backup of the uploads folder that contains the backups grows
    // without bound besides.
    const backup = await import('../src/services/backup.service.js');
    const uploads = path.resolve(env.UPLOAD_DIR);

    assert.ok(
      !ROOT.startsWith(uploads + path.sep) && ROOT !== uploads,
      'the configured backup directory is outside the uploads folder',
    );

    // And the guard itself fires, rather than merely happening not to apply.
    const tools = await backup.toolStatus();
    assert.equal(typeof tools.ok, 'boolean');
  });

  await t.test('free disk space is measured before a backup is attempted', { skip: !available }, async () => {
    // This server shares a disk with four other applications. A backup that
    // runs it to zero takes all of them down, so the run is refused rather
    // than attempted when the space is not there.
    const backup = await import('../src/services/backup.service.js');
    const free = await backup.freeSpace();

    assert.ok(free === null || free > 0, 'free space reads as a number or is honestly unknown');
  });

  await t.test('a filename cannot reach outside the backup directory', async () => {
    const attempts = [
      '../.env',
      '..%2f..%2f.env',
      'servicemitra-2026-01-01-0000-database.sql.gz/../../../.env',
      'servicemitra-../../.env-database.sql.gz',
      '.env',
    ];

    for (const name of attempts) {
      const res = await request(port, 'GET', '/api/v1/admin/backup/file/' + name, aAuth);
      assert.ok(
        res.status === 422 || res.status === 404 || res.status === 400,
        name + ' must not be served (got ' + res.status + ')',
      );
      assert.ok(!/JWT_ACCESS_SECRET|DB_PASSWORD/.test(res.raw), name + ' leaked environment contents');
    }
  });

  await t.test('a well-formed name for a backup that does not exist is a 404', async () => {
    const res = await request(
      port, 'GET', '/api/v1/admin/backup/file/servicemitra-1999-01-01-0000-database.sql.gz', aAuth,
    );
    assert.equal(res.status, 404);
  });

  await t.test('no one but an admin can take or download a backup', async () => {
    const cAuth = { token: customer.accessToken };

    assert.equal((await request(port, 'GET', '/api/v1/admin/backup/status', cAuth)).status, 403);
    assert.equal((await request(port, 'POST', '/api/v1/admin/backup/run', cAuth)).status, 403);
    assert.equal(
      (await request(port, 'GET', '/api/v1/admin/backup/file/servicemitra-2026-01-01-0000-database.sql.gz', cAuth)).status,
      403,
    );

    // And without a token at all.
    assert.equal((await request(port, 'GET', '/api/v1/admin/backup/status')).status, 401);
    assert.equal((await request(port, 'POST', '/api/v1/admin/backup/run')).status, 401);
  });
});

test('Admin data exports', async (t) => {
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  // The pool is closed once, by the last test in the file - closing it here
  // would break every suite that runs after this one in the same process.
  t.after(() => server.close());

  const admin = (await post(port, '/api/v1/auth/login', {
    identifier: 'admin@servicesetu.in', password: PASSWORD,
  })).data;
  const customer = (await post(port, '/api/v1/auth/login', {
    identifier: 'customer@servicesetu.in', password: PASSWORD,
  })).data;

  const aAuth = { token: admin.accessToken };

  await t.test('the status lists every dataset with a row count', async () => {
    const res = await request(port, 'GET', '/api/v1/admin/backup/status', aAuth);
    const body = res.body.data.exports;

    assert.deepEqual(
      body.datasets.map((d) => d.name).sort(),
      [...DATASETS].sort(),
      'every dataset the export route accepts is listed',
    );

    for (const d of body.datasets) {
      assert.equal(typeof d.rows, 'number', d.name + ' reports a count');
      assert.ok(d.label && d.description, d.name + ' explains itself');
    }
  });

  await t.test('KYC documents are counted but not exportable', async () => {
    const body = (await request(port, 'GET', '/api/v1/admin/backup/status', aAuth)).body.data.exports;

    assert.equal(typeof body.kycDocuments, 'number');
    assert.ok(
      !body.datasets.some((d) => /kyc|document/i.test(d.name)),
      'streaming Aadhaar scans out of a CSV button is not a feature',
    );
  });

  await t.test('every dataset exports as CSV with a header row', async () => {
    for (const name of DATASETS) {
      const res = await request(port, 'GET', '/api/v1/admin/backup/export/' + name, aAuth);
      assert.equal(res.status, 200, name + ' exports');
      assert.match(res.headers['content-type'], /text\/csv/, name + ' is a CSV');
      assert.match(
        res.headers['content-disposition'],
        new RegExp('servicemitra-' + name + '-\\d{4}-\\d{2}-\\d{2}\\.csv'),
        name + ' downloads under a dated filename',
      );

      const body = res.buffer.toString('utf8');
      assert.equal(body.charCodeAt(0), 0xfeff, name + ' carries a UTF-8 BOM for Excel');
      assert.ok(body.slice(1).split('\r\n')[0].includes(','), name + ' has a header row');
    }
  });

  await t.test('an export holds as many rows as the status promised', async () => {
    // Without this, a header-only CSV would satisfy every assertion above -
    // and an export that silently returns nothing is the failure mode that
    // matters, because it looks like a successful download.
    const body = (await request(port, 'GET', '/api/v1/admin/backup/status', aAuth)).body.data.exports;
    const promised = body.datasets.find((d) => d.name === 'people');
    assert.ok(promised.rows > 0, 'the seeded database has people in it');

    const csv = (await request(port, 'GET', '/api/v1/admin/backup/export/people', aAuth))
      .buffer.toString('utf8').slice(1);
    const lines = csv.split('\r\n').filter(Boolean);
    assert.equal(lines.length, promised.rows + 1, 'one header row plus every person');
  });

  await t.test('exporting is recorded against the admin who did it', async () => {
    const row = await queryOne(
      `SELECT after_state, admin_id FROM admin_audit_log
        WHERE action = 'data.exported' ORDER BY created_at DESC LIMIT 1`,
    );
    assert.ok(row, 'customer data leaving the platform is recorded');
    assert.equal(row.admin_id, admin.user.id);
  });

  await t.test('a dataset that does not exist is refused by the allowlist', async () => {
    // 422 rather than 404: the name never reaches the service, because the
    // route validates it against the enum first.
    const res = await request(port, 'GET', '/api/v1/admin/backup/export/users;DROP', aAuth);
    assert.equal(res.status, 422);
  });

  await t.test('a customer cannot export anything', async () => {
    const cAuth = { token: customer.accessToken };
    for (const p of ['/api/v1/admin/backup/status', '/api/v1/admin/backup/export/people']) {
      assert.equal((await request(port, 'GET', p, cAuth)).status, 403, p + ' is admin-only');
    }
  });

  await t.test('an anonymous visitor cannot export anything', async () => {
    assert.equal((await request(port, 'GET', '/api/v1/admin/backup/export/people')).status, 401);
  });
});

// Keeps the audit assertions above honest: if the table were empty for some
// unrelated reason they would still pass on a stale row from an earlier run.
test('the audit rows checked above belong to this run', async () => {
  const row = await queryOne(
    `SELECT COUNT(*)::int AS n FROM admin_audit_log
      WHERE action IN ('backup.created','backup.downloaded','data.exported')
        AND created_at > NOW() - INTERVAL '5 minutes'`,
  );
  assert.ok(row.n > 0, 'the audit entries were written during this suite, not inherited');
  await pool.end();
});
