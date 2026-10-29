/**
 * Structured logger. Every log line carries the correlation id of the
 * request that produced it, so a single booking can be traced from the
 * browser through the API and into the workers.
 */
import pino from 'pino';
import env from './env.js';

const transport = env.isDev
  ? {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
    }
  : undefined;

export const logger = pino({
  /**
   * LOG_LEVEL wins when it is set, so a debug session is one env var away.
   * Otherwise development sits at 'info' rather than 'debug': the debug lines
   * are for diagnosing this server, not for watching it run.
   */
  level: env.LOG_LEVEL || (env.isTest ? 'silent' : 'info'),
  transport,
  base: { service: 'servicesetu-api' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.refreshToken',
      '*.otp',
      // Payout destinations. A bank account number in a log file is a bank
      // account number somebody can read without ever touching the database.
      '*.accountNumber',
      '*.payout_account_number',
      '*.upiId',
      '*.payout_upi_id',
    ],
    censor: '[redacted]',
  },
});

export default logger;
