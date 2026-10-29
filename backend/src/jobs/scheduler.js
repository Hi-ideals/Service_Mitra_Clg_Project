/**
 * Background job scheduler.
 *
 * Deliberately in-process and dependency-free. The architecture calls for
 * BullMQ on Redis, and the task functions below are written so that moving
 * them onto a queue is a change of trigger, not of logic - each one is
 * idempotent, bounded, and returns a summary rather than throwing on partial
 * failure.
 *
 * Two safeguards matter here. A job never runs concurrently with itself, so a
 * slow run cannot pile up behind a fast interval. And a job that throws is
 * logged and skipped rather than killing the process - a failing reminder
 * sweep must not take the API down with it.
 */
import logger from '../config/logger.js';
import env from '../config/env.js';

const registry = new Map();
let running = false;

/**
 * @param name      identifier used in logs
 * @param everyMs   interval between runs
 * @param handler   async () => summary
 * @param runOnBoot whether to run once at startup
 */
export function register(name, { everyMs, handler, runOnBoot = false }) {
  registry.set(name, { name, everyMs, handler, runOnBoot, timer: null, inFlight: false, runs: 0, failures: 0, lastRun: null, lastError: null });
}

async function execute(job) {
  if (job.inFlight) {
    logger.warn({ job: job.name }, 'Skipping scheduled run, the previous one is still going');
    return;
  }

  job.inFlight = true;
  const startedAt = Date.now();

  try {
    const summary = await job.handler();
    job.runs += 1;
    job.lastRun = new Date();
    job.lastError = null;

    const ms = Date.now() - startedAt;
    // Only worth a log line when the job actually did something.
    const didWork = summary && Object.values(summary).some((v) => typeof v === 'number' && v > 0);
    if (didWork) logger.info({ job: job.name, ms, ...summary }, 'Scheduled job did work');
    else logger.debug({ job: job.name, ms }, 'Scheduled job ran, nothing to do');
  } catch (err) {
    job.failures += 1;
    job.lastError = err.message;
    logger.error({ err, job: job.name }, 'Scheduled job failed');
  } finally {
    job.inFlight = false;
  }
}

export function start() {
  if (running) return;
  if (env.isTest) {
    logger.debug('Scheduler not started in test mode');
    return;
  }

  running = true;

  for (const job of registry.values()) {
    job.timer = setInterval(() => execute(job), job.everyMs);
    // unref so a pending timer never keeps the process alive during shutdown.
    job.timer.unref?.();
    if (job.runOnBoot) execute(job);
  }

  logger.info({ jobs: [...registry.keys()] }, 'Background scheduler started');
}

export function stop() {
  for (const job of registry.values()) {
    if (job.timer) clearInterval(job.timer);
    job.timer = null;
  }
  running = false;
  logger.info('Background scheduler stopped');
}

/** Exposed on the health endpoint so a stuck job is visible without log diving. */
export function status() {
  return {
    running,
    jobs: [...registry.values()].map((j) => ({
      name: j.name,
      everyMs: j.everyMs,
      runs: j.runs,
      failures: j.failures,
      inFlight: j.inFlight,
      lastRun: j.lastRun,
      lastError: j.lastError,
    })),
  };
}

/** Runs one job immediately by name. Used by tests and by an admin trigger. */
export async function runNow(name) {
  const job = registry.get(name);
  if (!job) throw new Error('No scheduled job named "' + name + '"');
  return job.handler();
}

export default { register, start, stop, status, runNow };
