/**
 * Rate limits. Authentication endpoints are the ones worth protecting hardest -
 * they are where credential stuffing and OTP brute force land.
 */
import rateLimit from 'express-rate-limit';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';

const handler = (_req, _res, next) => {
  next(ApiError.tooMany('Too many requests. Please wait a moment and try again.'));
};

const base = {
  standardHeaders: true,
  legacyHeaders: false,
  handler,
  skip: () => env.isTest,
};

/** Broad protection for the whole API surface. */
export const globalLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 1000,
});

/** Login, register, refresh - per IP. */
export const authLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
});

/** OTP send/verify - tighter, because each one costs money and can be brute forced. */
export const otpLimiter = rateLimit({
  ...base,
  windowMs: 10 * 60 * 1000,
  limit: 6,
});

/**
 * The second factor, and the endpoints that change it.
 *
 * Tighter than the login limiter and counting successes too. A six-digit code
 * is a million possibilities, which sounds like a lot until it is tried at
 * machine speed: ten attempts per ten minutes per IP turns a few hours of
 * guessing into a few years of it. The replay guard on each accepted code does
 * the rest.
 */
export const twoFactorLimiter = rateLimit({
  ...base,
  windowMs: 10 * 60 * 1000,
  limit: 10,
});

/** Writes that create real-world obligations: bookings, reviews, uploads. */
export const writeLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: 30,
});

export default { globalLimiter, authLimiter, otpLimiter, twoFactorLimiter, writeLimiter };
