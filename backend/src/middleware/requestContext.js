/**
 * Attaches a correlation id to every request and echoes it back on the
 * response, so a single user action can be traced across API and workers.
 */
import crypto from 'node:crypto';

export function requestContext(req, res, next) {
  const incoming = req.headers['x-request-id'];
  req.id = typeof incoming === 'string' && incoming.length <= 64 ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  req.startedAt = Date.now();
  next();
}

export default requestContext;
