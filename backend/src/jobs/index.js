/**
 * Job registration.
 *
 * Intervals are chosen against what the task is actually waiting for, not by
 * habit: expiry runs often because a customer is staring at a pending request,
 * payouts run hourly because the schedule is daily at most, and orphan cleanup
 * runs nightly because nothing depends on its timeliness.
 */
import { register, start, stop, status, runNow } from './scheduler.js';
import * as tasks from './tasks.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export function registerJobs() {
  register('expire-requests', {
    everyMs: 5 * MINUTE,
    handler: tasks.expireRequests,
    runOnBoot: true,
  });

  register('close-dispute-windows', {
    everyMs: 15 * MINUTE,
    handler: tasks.closeDisputeWindows,
    runOnBoot: true,
  });

  register('nudge-stalled-jobs', {
    everyMs: HOUR,
    handler: tasks.nudgeStalled,
  });

  register('retry-notifications', {
    everyMs: 10 * MINUTE,
    handler: tasks.retryNotifications,
  });

  register('reconcile-payments', {
    everyMs: HOUR,
    handler: tasks.reconcilePayments,
  });

  register('release-payouts', {
    everyMs: HOUR,
    handler: tasks.releasePayouts,
  });

  // Hourly, but `isDue` inside the task is what decides whether it actually
  // dumps - so BACKUP_EVERY_HOURS can be set to anything from 1 upwards
  // without the interval here needing to match it.
  register('database-backup', {
    everyMs: HOUR,
    handler: tasks.backupDatabase,
    runOnBoot: true,
  });

  register('purge-unconfirmed-signups', {
    everyMs: 6 * HOUR,
    handler: tasks.purgeUnconfirmedSignups,
  });

  register('clean-orphaned-files', {
    everyMs: 24 * HOUR,
    handler: tasks.cleanOrphanedFiles,
  });
}

export { start, stop, status, runNow, tasks };

export default { registerJobs, start, stop, status, runNow };
