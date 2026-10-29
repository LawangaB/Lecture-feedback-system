import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import { AppError } from '../utils/errors.ts';

export interface RateLimits {
  global: number;
  auth: number;
  join: number;
  submit: number;
  feedback: number;
  exports: number;
}

export const defaultLimits: RateLimits = { global: 600, auth: 10, join: 20, submit: 60, feedback: 10, exports: 10 };

function limiter(max: number, windowMs: number, keyPrefix: string, key?: (req: Request) => string) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `${keyPrefix}:${key ? key(req) : ipKeyGenerator(req.ip ?? '')}`,
    handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Please slow down and try again shortly.')),
  });
}

/**
 * In-memory stores: correct for a single API instance. For several instances use a shared store (e.g. Redis).
 */
export function buildLimiters(l: RateLimits) {
  const userOrIp = (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? '');
  return {
    global: limiter(l.global, 60_000, 'global'),
    // Keyed by IP and target email so one attacker cannot lock out an account from everywhere, and vice versa.
    auth: limiter(l.auth, 15 * 60_000, 'auth', (req) => `${ipKeyGenerator(req.ip ?? '')}|${String(req.body?.email ?? '').toLowerCase().slice(0, 254)}`),
    authIp: limiter(l.auth * 5, 15 * 60_000, 'authip'),
    join: limiter(l.join, 60_000, 'join', userOrIp),
    submit: limiter(l.submit, 60_000, 'submit', userOrIp),
    feedback: limiter(l.feedback, 60_000, 'feedback', userOrIp),
    exports: limiter(l.exports, 60_000, 'exports', userOrIp),
  };
}
export type Limiters = ReturnType<typeof buildLimiters>;
