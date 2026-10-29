/**
 * File upload handling.
 *
 * Files are held in memory, validated, then handed to the storage service -
 * nothing is written to disk before its type and size have been checked. The
 * declared mime type is not trusted on its own; the magic bytes are checked
 * too, so a script renamed to .jpg is rejected.
 */
import multer from 'multer';
import path from 'node:path';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';

const ALLOWED = new Map([
  ['image/jpeg', ['.jpg', '.jpeg']],
  ['image/png', ['.png']],
  ['image/webp', ['.webp']],
  ['application/pdf', ['.pdf']],
]);

/** First bytes of each accepted format. */
const MAGIC = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],
};

function matchesMagic(buffer, mime) {
  const signatures = MAGIC[mime];
  if (!signatures) return false;
  return signatures.some((sig) => sig.every((byte, i) => buffer[i] === byte));
}

/** Rejects anything whose declared type does not match its actual content. */
export function assertRealFile(file) {
  if (!file) throw ApiError.badRequest('No file was uploaded');

  if (!ALLOWED.has(file.mimetype)) {
    throw ApiError.badRequest('Upload a JPG, PNG, WEBP or PDF file');
  }

  if (!matchesMagic(file.buffer, file.mimetype)) {
    throw ApiError.badRequest('This file does not look like a real ' + file.mimetype.split('/')[1].toUpperCase() + ' file');
  }

  // The extension has to agree with the content too. The bytes decide what the
  // file is, but the name is what gets stored and shown back to a reviewer, and
  // a real JPEG called "invoice.exe" is a trap waiting for someone to click it.
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED.get(file.mimetype).includes(ext)) {
    throw ApiError.badRequest(
      'Rename the file to end in ' + ALLOWED.get(file.mimetype).join(' or ') + ' before uploading it',
    );
  }

  return true;
}

const limits = { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 };

const fileFilter = (_req, file, cb) => {
  if (!ALLOWED.has(file.mimetype)) {
    return cb(ApiError.badRequest('Upload a JPG, PNG, WEBP or PDF file'));
  }
  return cb(null, true);
};

const engine = multer({ storage: multer.memoryStorage(), limits, fileFilter });

/** Single-file upload under the given field name. */
export function uploadSingle(field = 'file') {
  const handler = engine.single(field);
  return (req, res, next) =>
    handler(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(ApiError.badRequest('The file must be smaller than ' + env.MAX_UPLOAD_MB + ' MB'));
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(ApiError.badRequest('Unexpected file field "' + err.field + '"'));
      }
      return next(err);
    });
}

export default uploadSingle;
