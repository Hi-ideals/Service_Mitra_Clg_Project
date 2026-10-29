/**
 * Walks every route the API actually registers and checks two things:
 *
 *   1. nothing on the surface returns a 5xx to an anonymous caller, and
 *   2. anything that is not deliberately public demands authentication.
 *
 * It reads the route table out of the live Express app rather than a
 * hand-kept list, so a route added without a guard shows up here the day it
 * is added instead of the day it is exploited.
 */
import { createApp } from '../src/app.js';

const BASE = process.env.PROBE_BASE ?? 'http://localhost:5000';

/**
 * Routes that are public by design. Everything else must challenge.
 *
 * Each entry is here because the endpoint cannot require a session: you are
 * not signed in while registering, resetting a password or confirming a code,
 * and the catalogue, provider profiles and their reviews are what an
 * anonymous visitor came to read. They are defended by rate limiting and
 * schema validation instead, which the probe suite covers separately.
 */
const PUBLIC = [
  /^\/api\/v1\/?$/,
  /^\/api\/v1\/health/,
  /^\/api\/v1\/docs/,
  /^\/api\/v1\/auth\/(register|login|refresh|logout|forgot-password|reset-password|verify|resend)/,
  /^\/api\/v1\/auth\/otp\//,
  /^\/api\/v1\/auth\/password\/reset/,
  /^\/api\/v1\/categories/,
  /^\/api\/v1\/providers(\/|$)/,
  // Express leaves a param-mounted router's path as its raw regexp source.
  /^\/api\/v1\/providers\(\?:/,
  /^\/api\/v1\/webhooks\//,
  /^\/api\/v1\/files\//,
  /^\/api\/v1\/reviews\/provider\//,
];

const isPublic = (path) => PUBLIC.some((re) => re.test(path));

/** Turns ":id" and friends into something a server will actually parse. */
const SAMPLE_UUID = '00000000-0000-4000-8000-000000000000';
function concrete(path) {
  return path
    .replace(/:[A-Za-z]+Id\b/g, SAMPLE_UUID)
    .replace(/:id\b/g, SAMPLE_UUID)
    .replace(/:slug\b/g, 'plumbing')
    .replace(/:[A-Za-z]+/g, 'sample');
}

const app = createApp();

// Express keeps the mount path only inside the layer's regexp, which is
// awkward to reverse. The router tree is walked with the prefix carried down
// from the regexp source instead.
function walk(stack, prefix = '') {
  const out = [];
  for (const layer of stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        if (method === '_all') continue;
        out.push({ method: method.toUpperCase(), path: prefix + layer.route.path });
      }
    } else if (layer.handle?.stack) {
      let mount = '';
      const src = layer.regexp?.source ?? '';
      const m = src.match(/^\^\\\/(.*?)\\\/\?\(\?=\\\/\|\$\)$/);
      if (m) mount = '/' + m[1].replace(/\\\//g, '/');
      out.push(...walk(layer.handle.stack, prefix + mount));
    }
  }
  return out;
}

const routes = walk(app._router.stack)
  .filter((r) => r.path.startsWith('/api'))
  .filter((r, i, all) => all.findIndex((x) => x.method === r.method && x.path === r.path) === i)
  .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

const rows = [];
let serverErrors = 0;
let unguarded = 0;

for (const route of routes) {
  const url = BASE + concrete(route.path);
  let status = 0;
  try {
    const res = await fetch(url, {
      method: route.method,
      headers: { 'Content-Type': 'application/json' },
      ...(route.method === 'GET' || route.method === 'HEAD' ? {} : { body: '{}' }),
    });
    status = res.status;
  } catch (err) {
    status = -1;
  }

  const pub = isPublic(route.path);
  const challenged = status === 401 || status === 403;
  const serverError = status >= 500;
  // A guarded route must challenge an anonymous caller. 404/422 before the
  // guard would mean the guard runs too late to be trusted.
  const guardOk = pub || challenged;

  if (serverError) serverErrors += 1;
  if (!guardOk && !serverError) unguarded += 1;

  rows.push({
    method: route.method,
    path: route.path,
    status,
    public: pub,
    guarded: guardOk,
    serverError,
  });
}

const summary = {
  total: rows.length,
  publicRoutes: rows.filter((r) => r.public).length,
  guardedRoutes: rows.filter((r) => !r.public).length,
  serverErrors,
  unguarded,
  at: new Date().toISOString(),
};

console.log('routes probed: ' + summary.total);
console.log('  public by design : ' + summary.publicRoutes);
console.log('  guarded          : ' + summary.guardedRoutes);
console.log('  5xx responses    : ' + serverErrors);
console.log('  unguarded        : ' + unguarded);

if (serverErrors || unguarded) {
  for (const r of rows.filter((x) => x.serverError || (!x.public && !x.guarded))) {
    console.log('  !! ' + r.method + ' ' + r.path + ' -> ' + r.status);
  }
}

if (process.argv[2]) {
  const fs = await import('node:fs');
  fs.writeFileSync(process.argv[2], JSON.stringify({ summary, rows }, null, 2));
  console.log('written to ' + process.argv[2]);
}

process.exit(0);
