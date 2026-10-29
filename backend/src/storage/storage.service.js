/**
 * File storage.
 *
 * KYC documents are private by default: the database holds only a storage key,
 * and the file is reachable only through a short-lived signed URL. Nothing is
 * ever served from a guessable path, so a leaked key alone is not enough to
 * read someone's identity document.
 *
 * The local driver writes to disk for development. The S3 driver slots in
 * behind the same interface without any caller changing.
 */
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import logger from '../config/logger.js';

const PRIVATE_ROOT = path.resolve(env.UPLOAD_DIR, 'private');
const PUBLIC_ROOT = path.resolve(env.UPLOAD_DIR, 'public');

/** Signed URLs are valid for minutes, not hours. */
export const DEFAULT_TTL_SECONDS = 300;

/**
 * Types a browser may be told to render in place.
 *
 * The upload allowlist and this one are separate on purpose. Upload decides
 * what may be stored; this decides what may be handed back with a type the
 * browser will act on. Anything not on this list is served as an opaque
 * download, so a file that slipped past validation cannot execute itself in
 * an admin's session just because a header said it was safe.
 */
const SERVABLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

/**
 * The content type and filename are part of what is signed.
 *
 * They have to travel in the URL - the /files route has no session to look
 * them up from - and an unsigned content type would be an open invitation to
 * request someone's JPEG back as text/html.
 */
function signature(key, expires, contentType = '', filename = '') {
  return crypto
    .createHmac('sha256', env.JWT_ACCESS_SECRET)
    .update([key, expires, contentType, filename].join('|'))
    .digest('hex');
}

/** Strips anything that would let a filename break out of a header or a folder. */
function safeFilename(name) {
  if (!name) return '';
  return path.basename(String(name)).replace(/[^\w.\- ]+/g, '_').slice(0, 120);
}

export function isServableInline(contentType) {
  return SERVABLE_TYPES.has(contentType);
}

/**
 * Storage keys are generated, never taken from the client, and are checked on
 * the way back out so that "../" can never escape the storage root.
 */
function resolveSafe(root, key) {
  const full = path.resolve(root, key);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw ApiError.badRequest('Invalid storage key');
  }
  return full;
}

export function buildKey({ scope, ownerId, originalName }) {
  const ext = path.extname(originalName || '').toLowerCase().slice(0, 10);
  const random = crypto.randomBytes(16).toString('hex');
  const stamp = new Date().toISOString().slice(0, 10);
  return [scope, ownerId, stamp + '-' + random + ext].join('/');
}

const localDriver = {
  async put(key, buffer, { isPublic = false } = {}) {
    const root = isPublic ? PUBLIC_ROOT : PRIVATE_ROOT;
    const full = resolveSafe(root, key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, buffer);
    return { key, size: buffer.length };
  },

  async stream(key, { isPublic = false } = {}) {
    const full = resolveSafe(isPublic ? PUBLIC_ROOT : PRIVATE_ROOT, key);
    try {
      await fs.access(full);
    } catch {
      throw ApiError.notFound('File not found');
    }
    return createReadStream(full);
  },

  async remove(key, { isPublic = false } = {}) {
    const full = resolveSafe(isPublic ? PUBLIC_ROOT : PRIVATE_ROOT, key);
    await fs.rm(full, { force: true });
    return true;
  },

  async exists(key, { isPublic = false } = {}) {
    try {
      await fs.access(resolveSafe(isPublic ? PUBLIC_ROOT : PRIVATE_ROOT, key));
      return true;
    } catch {
      return false;
    }
  },
};

const drivers = { local: localDriver };

function driver() {
  const d = drivers[env.STORAGE_DRIVER];
  if (!d) throw ApiError.internal('Storage driver "' + env.STORAGE_DRIVER + '" is not configured');
  return d;
}

export const put = (key, buffer, options) => driver().put(key, buffer, options);
export const stream = (key, options) => driver().stream(key, options);
export const remove = (key, options) => driver().remove(key, options);
export const exists = (key, options) => driver().exists(key, options);

/**
 * A time-limited URL for one private file.
 *
 * The caller passes the type and name recorded at upload time, because the
 * storage layer knows only bytes. Deriving the type from the key's extension
 * instead would mean trusting a filename the uploader chose.
 */
export function signedUrl(key, options = DEFAULT_TTL_SECONDS) {
  if (!key) return null;

  const { ttlSeconds = DEFAULT_TTL_SECONDS, contentType = '', filename = '' } =
    typeof options === 'number' ? { ttlSeconds: options } : options;

  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const ct = contentType || '';
  const name = safeFilename(filename);

  const params = new URLSearchParams({ key, expires: String(expires) });
  if (ct) params.set('ct', ct);
  if (name) params.set('name', name);
  params.set('signature', signature(key, expires, ct, name));

  return env.API_PREFIX + '/files?' + params.toString();
}

/** Validates a signed URL. Throws rather than returning false, so callers cannot ignore it. */
export function verifySignedUrl({ key, expires, signature: provided, ct = '', name = '' }) {
  if (!key || !expires || !provided) throw ApiError.forbidden('This link is not valid');

  const expected = signature(key, expires, ct, name);
  const a = Buffer.from(String(provided));
  const b = Buffer.from(expected);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw ApiError.forbidden('This link is not valid');
  }

  if (Number(expires) * 1000 < Date.now()) {
    throw ApiError.forbidden('This link has expired. Reload the page to get a fresh one.');
  }

  return true;
}

export async function ensureDirectories() {
  await fs.mkdir(PRIVATE_ROOT, { recursive: true });
  await fs.mkdir(PUBLIC_ROOT, { recursive: true });
  logger.debug({ PRIVATE_ROOT, PUBLIC_ROOT }, 'Storage directories ready');
}

export default {
  buildKey, put, stream, remove, exists, signedUrl, verifySignedUrl, isServableInline,
  ensureDirectories, DEFAULT_TTL_SECONDS,
};
