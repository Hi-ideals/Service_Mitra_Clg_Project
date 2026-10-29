/**
 * The single error shape the API speaks. Anything thrown that is not an
 * ApiError is treated as an unexpected fault and reported as a 500 with
 * its detail hidden from the client.
 */
export class ApiError extends Error {
  constructor(statusCode, message, { code = undefined, details = undefined, cause } = {}) {
    super(message, { cause });
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code || ApiError.defaultCode(statusCode);
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace?.(this, ApiError);
  }

  static defaultCode(status) {
    return (
      {
        400: 'BAD_REQUEST',
        401: 'UNAUTHENTICATED',
        403: 'FORBIDDEN',
        404: 'NOT_FOUND',
        409: 'CONFLICT',
        410: 'GONE',
        422: 'VALIDATION_FAILED',
        429: 'RATE_LIMITED',
        500: 'INTERNAL_ERROR',
        503: 'SERVICE_UNAVAILABLE',
      }[status] || 'ERROR'
    );
  }

  static badRequest(m = 'Bad request', o) { return new ApiError(400, m, o); }
  static unauthorized(m = 'Authentication required', o) { return new ApiError(401, m, o); }
  static forbidden(m = 'You do not have permission to perform this action', o) { return new ApiError(403, m, o); }
  static notFound(m = 'Resource not found', o) { return new ApiError(404, m, o); }
  static conflict(m = 'Conflict with the current state of the resource', o) { return new ApiError(409, m, o); }
  static validation(m = 'Validation failed', o) { return new ApiError(422, m, o); }
  static tooMany(m = 'Too many requests', o) { return new ApiError(429, m, o); }
  static internal(m = 'Something went wrong', o) { return new ApiError(500, m, o); }
}

export default ApiError;
