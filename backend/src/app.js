/**
 * Express application assembly.
 *
 * The order of this middleware chain is the request pipeline from the
 * architecture document: security -> parsing -> context -> rate limit ->
 * routes -> not found -> error handler. Nothing below the router is allowed to
 * send a response except the error handler.
 */
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';

import env from './config/env.js';
import logger from './config/logger.js';
import requestContext from './middleware/requestContext.js';
import { globalLimiter } from './middleware/rateLimit.js';
import notFound from './middleware/notFound.js';
import errorHandler from './middleware/errorHandler.js';
import healthRoutes from './routes/health.routes.js';
import apiRoutes from './routes/index.js';
import ApiError from './utils/ApiError.js';

export function createApp() {
  const app = express();

  // Behind Nginx or a load balancer, trust the proxy so client IPs used by the
  // rate limiter and the audit log are the real ones.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // ---------- security ----------
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // This process serves JSON and downloads, never HTML that executes, so
      // the policy is as close to "nothing" as a CSP gets. It still matters:
      // it is what stops an uploaded file rendering as a page if a
      // Content-Type ever slips through wrong.
      contentSecurityPolicy: env.isProd
        ? {
            directives: {
              defaultSrc: ["'none'"],
              frameAncestors: ["'none'"],
              baseUri: ["'none'"],
              formAction: ["'none'"],
            },
          }
        : false,
      // Tell browsers to refuse plain HTTP for a year. Only meaningful in
      // production, where TLS actually terminates in front of this process.
      hsts: env.isProd ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin and server-to-server calls arrive without an Origin header.
        if (!origin) return callback(null, true);
        if (env.corsOrigins.includes(origin)) return callback(null, true);
        return callback(ApiError.forbidden('Origin ' + origin + ' is not allowed'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 86400,
    }),
  );

  // ---------- parsing ----------
  // The payment webhook needs the raw body to verify its signature, so it is
  // captured here before JSON parsing replaces it.
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        if (req.originalUrl.includes('/webhook')) req.rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());
  app.use(compression());

  // ---------- context and logging ----------
  app.use(requestContext);
  if (env.logHttp !== 'off') {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req) => req.id,
        autoLogging: {
          ignore: (req) => req.url === '/health' || req.url === '/favicon.ico',
        },
        customLogLevel: (_req, res, err) => {
          // A 5xx is kept in both modes: if something escaped the error
          // handler entirely, this is the only record that it happened.
          if (err || res.statusCode >= 500) return 'error';

          // Everything else is already logged by the error handler, with the
          // message and the reason attached. In 'errors' mode this line would
          // just be the same failure printed a second time, less usefully.
          if (env.logHttp !== 'all') return 'silent';

          return res.statusCode >= 400 ? 'warn' : 'info';
        },
        customSuccessMessage: (req, res) =>
          req.method + ' ' + req.url + ' -> ' + res.statusCode,
        /**
         * One line per request instead of a full header dump.
         *
         * pino-http serialises the whole req and res by default, which is
         * useful when a machine reads the log and unreadable when a person
         * does. Everything dropped here is still reconstructable from the
         * request id, which stays on the line.
         */
        serializers: {
          req: (req) => ({ method: req.method, url: req.url }),
          res: (res) => ({ statusCode: res.statusCode }),
        },
      }),
    );
  }

  // ---------- public uploads ----------
  // Category photos an admin uploads. Mounted under the API prefix because that
  // is the only path nginx and the Vite dev server forward to this process - a
  // bare /static is answered by the web container with the app's index.html.
  // Ahead of the rate limiter: a home page paints a dozen of these at once, and
  // they should not spend the visitor's request budget.
  app.use(env.API_PREFIX + '/static', express.static(env.UPLOAD_DIR + '/public', { maxAge: '7d' }));

  // ---------- rate limiting ----------
  app.use(env.API_PREFIX, globalLimiter);

  // ---------- static files ----------
  // Public assets only. KYC documents are never served from here; they are
  // delivered through short-lived signed URLs by the storage service.
  app.use('/static', express.static(env.UPLOAD_DIR + '/public', { maxAge: '7d' }));

  // ---------- routes ----------
  app.use('/health', healthRoutes);
  app.use(env.API_PREFIX, apiRoutes);

  app.get('/', (_req, res) => {
    res.json({
      success: true,
      message: 'ServiceMitra - Local Service Marketplace API',
      version: '1.0.0',
      api: env.API_PREFIX,
      health: '/health',
    });
  });

  // ---------- failure paths ----------
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp;
