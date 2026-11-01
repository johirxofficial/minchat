import { redis } from '../redis.js';
import { logger } from '../logger.js';
import { AppError } from '../lib/errors.js';

/**
 * Redis-backed fixed-window rate limiter. Keys are bucketed by window so they
 * expire automatically and no client-controlled state is trusted.
 */
export function rateLimit({ name, windowMs, max, keyGenerator, message }) {
  return async (req, res, next) => {
    try {
      const identifier = keyGenerator ? keyGenerator(req) : req.auth?.user?.id || req.ip || 'unknown';
      if (!identifier) return next();
      const bucket = Math.floor(Date.now() / windowMs);
      const key = `minchat:rl:${name}:${identifier}:${bucket}`;
      const count = await redis.incr(key);
      if (count === 1) await redis.pexpire(key, windowMs);
      const remaining = Math.max(0, max - count);
      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(remaining));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(((bucket + 1) * windowMs) / 1000)));
      if (count > max) {
        const ttl = await redis.pttl(key);
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(ttl / 1000))));
        return next(new AppError(429, 'RATE_LIMITED', message || 'Too many requests. Please try again later.'));
      }
      next();
    } catch (err) {
      // Availability over strictness: never lock everyone out because Redis hiccuped.
      logger.error({ err, name }, 'rate limiter unavailable; allowing request');
      next();
    }
  };
}

export const loginLimiter = rateLimit({
  name: 'login-ip',
  windowMs: 15 * 60_000,
  max: 30,
  message: 'Too many sign-in attempts from this address. Try again in 15 minutes.'
});

export const registerLimiter = rateLimit({
  name: 'register-ip',
  windowMs: 60 * 60_000,
  max: 8,
  message: 'Too many accounts created from this address. Try again later.'
});

export const searchLimiter = rateLimit({
  name: 'search',
  windowMs: 60_000,
  max: 40,
  keyGenerator: (req) => req.auth?.user?.id || req.ip,
  message: 'Search is rate limited. Please slow down.'
});

export const messageLimiter = rateLimit({
  name: 'message',
  windowMs: 60_000,
  max: 100,
  keyGenerator: (req) => req.auth?.user?.id || req.ip,
  message: 'You are sending messages too quickly.'
});

export const uploadLimiter = rateLimit({
  name: 'upload',
  windowMs: 60 * 60_000,
  max: 60,
  keyGenerator: (req) => req.auth?.user?.id || req.ip,
  message: 'Upload limit reached. Try again later.'
});

export const callLimiter = rateLimit({
  name: 'call',
  windowMs: 60_000,
  max: 12,
  keyGenerator: (req) => req.auth?.user?.id || req.ip,
  message: 'Too many call attempts. Please wait a moment.'
});

export const friendLimiter = rateLimit({
  name: 'friend-request',
  windowMs: 60 * 60_000,
  max: 25,
  keyGenerator: (req) => req.auth?.user?.id || req.ip,
  message: 'Too many friend requests. Try again later.'
});

export const reportLimiter = rateLimit({
  name: 'report',
  windowMs: 60 * 60_000,
  max: 10,
  keyGenerator: (req) => req.auth?.user?.id || req.ip,
  message: 'Too many reports submitted. Try again later.'
});

export const apiLimiter = rateLimit({
  name: 'api',
  windowMs: 60_000,
  max: 600,
  keyGenerator: (req) => req.auth?.user?.id || req.ip,
  message: 'Too many requests.'
});

export async function socketRateLimit(identifier, name, max, windowMs = 10_000) {
  const bucket = Math.floor(Date.now() / windowMs);
  const key = `minchat:rl:socket:${name}:${identifier}:${bucket}`;
  try {
    const n = await redis.incr(key);
    if (n === 1) await redis.pexpire(key, windowMs);
    return n <= max;
  } catch {
    return true;
  }
}
