/**
 * Liveness and readiness.
 *
 * /health   - is the process alive? Never touches the database, so a database
 *             outage does not make the container get killed and restarted.
 * /health/ready - should this instance receive traffic? Checks dependencies.
 */
import { Router } from 'express';
import { healthcheck } from '../db/pool.js';
import asyncHandler from '../utils/asyncHandler.js';
import env from '../config/env.js';
import { status as jobStatus } from '../jobs/scheduler.js';

const router = Router();

const startedAt = Date.now();

router.get('/', (_req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    service: 'servicesetu-api',
    environment: env.NODE_ENV,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  });
});

router.get(
  '/ready',
  asyncHandler(async (_req, res) => {
    let database = { ok: false, latencyMs: null, error: null };
    try {
      const result = await healthcheck();
      database = { ...result, error: null };
    } catch (err) {
      database = { ok: false, latencyMs: null, error: err.message };
    }

    const jobs = jobStatus();
    const ready = database.ok;

    res.status(ready ? 200 : 503).json({
      success: ready,
      status: ready ? 'ready' : 'not_ready',
      checks: {
        database,
        // Reported but not part of readiness: a failing reminder sweep is
        // worth seeing, but it must not take an instance out of the pool.
        scheduler: {
          running: jobs.running,
          failing: jobs.jobs.filter((j) => j.lastError).map((j) => j.name),
        },
      },
      timestamp: new Date().toISOString(),
    });
  }),
);

export default router;
