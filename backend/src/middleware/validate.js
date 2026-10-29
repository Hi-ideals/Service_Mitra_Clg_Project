/**
 * Schema validation for incoming requests.
 *
 * Validation happens before a controller ever runs, and the parsed (coerced,
 * stripped) result replaces the raw input - so services can trust their input
 * and never re-check shapes.
 */
import { ZodError } from 'zod';
import ApiError from '../utils/ApiError.js';

function run(schema, value, location) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const details = result.error.issues.map((i) => ({
    field: [location, ...i.path].filter(Boolean).join('.'),
    message: i.message,
  }));
  throw new ApiError(422, 'Validation failed', { code: 'VALIDATION_FAILED', details });
}

/**
 * validate({ body, query, params }) - each key is optional.
 * Note: req.query is a getter on newer Express versions, so validated query
 * values are exposed on req.validatedQuery as well as merged back where possible.
 */
export function validate(schemas = {}) {
  return (req, _res, next) => {
    try {
      if (schemas.params) req.params = run(schemas.params, req.params, 'params');
      if (schemas.body) req.body = run(schemas.body, req.body ?? {}, 'body');
      if (schemas.query) {
        const parsed = run(schemas.query, req.query ?? {}, 'query');
        req.validatedQuery = parsed;
        try {
          req.query = parsed;
        } catch {
          // Express 5 exposes req.query as a read-only getter; validatedQuery is the source of truth.
        }
      }
      next();
    } catch (err) {
      next(err instanceof ZodError ? err : err);
    }
  };
}

/** Convenience accessor so controllers do not care which Express version is running. */
export const q = (req) => req.validatedQuery ?? req.query ?? {};

export default validate;
