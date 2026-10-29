/**
 * The single exit point for every failure in the API.
 *
 * Operational errors (ApiError) are reported as-is. Everything else - a bug, a
 * driver fault, a constraint we did not anticipate - is logged in full and
 * reported to the client as a generic 500, so internals never leak.
 */
import { ZodError } from 'zod';
import ApiError from '../utils/ApiError.js';
import logger from '../config/logger.js';
import env from '../config/env.js';

/** Maps PostgreSQL error codes onto the API's own vocabulary. */
function fromPostgres(err) {
  switch (err.code) {
    case '23505': // unique_violation
      return new ApiError(409, 'A record with these details already exists', {
        code: 'DUPLICATE_RECORD',
        details: { constraint: err.constraint },
      });
    case '23503': // foreign_key_violation
      return new ApiError(400, 'Referenced record does not exist', {
        code: 'INVALID_REFERENCE',
        details: { constraint: err.constraint },
      });
    case '23502': // not_null_violation
      return new ApiError(400, 'Required field "' + err.column + '" is missing', {
        code: 'MISSING_FIELD',
      });
    case '23514': // check_violation
      return new ApiError(400, 'Value violates a business rule', {
        code: 'CHECK_FAILED',
        details: { constraint: err.constraint },
      });
    case '22P02': // invalid_text_representation
      return new ApiError(400, 'Malformed value in request', { code: 'INVALID_VALUE' });
    case '40001': // serialization_failure
    case '40P01': // deadlock_detected
      return new ApiError(409, 'The request conflicted with another operation, please retry', {
        code: 'WRITE_CONFLICT',
      });
    case 'ECONNREFUSED':
    case '57P03': // cannot_connect_now
      return new ApiError(503, 'Service temporarily unavailable', { code: 'DB_UNAVAILABLE' });
    default:
      return null;
  }
}

function normalise(err) {
  if (err instanceof ApiError) return err;

  if (err instanceof ZodError) {
    return new ApiError(422, 'Validation failed', {
      code: 'VALIDATION_FAILED',
      details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }

  if (err?.name === 'TokenExpiredError') {
    return new ApiError(401, 'Your session has expired, please sign in again', {
      code: 'TOKEN_EXPIRED',
    });
  }
  if (err?.name === 'JsonWebTokenError') {
    return new ApiError(401, 'Invalid authentication token', { code: 'TOKEN_INVALID' });
  }

  if (err?.type === 'entity.parse.failed') {
    return new ApiError(400, 'Request body is not valid JSON', { code: 'MALFORMED_JSON' });
  }
  if (err?.type === 'entity.too.large') {
    return new ApiError(413, 'Request body is too large', { code: 'PAYLOAD_TOO_LARGE' });
  }

  const pg = fromPostgres(err);
  if (pg) return pg;

  return null;
}

export function errorHandler(err, req, res, _next) {
  const known = normalise(err);
  const statusCode = known ? known.statusCode : 500;

  const log = {
    reqId: req.id,
    method: req.method,
    url: req.originalUrl,
    status: statusCode,
    userId: req.user?.id,
    role: req.user?.role,
  };

  if (statusCode >= 500) {
    logger.error({ ...log, err }, 'Request failed');
  } else {
    logger.warn({ ...log, message: known.message }, 'Request rejected');
  }

  const body = {
    success: false,
    error: {
      code: known ? known.code : 'INTERNAL_ERROR',
      message: known ? known.message : 'Something went wrong on our side',
    },
    requestId: req.id,
  };

  if (known?.details) body.error.details = known.details;
  if (!known && env.isDev) body.error.debug = { message: err?.message, stack: err?.stack };

  res.status(statusCode).json(body);
}

export default errorHandler;
