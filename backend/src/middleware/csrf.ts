import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.ts';
import { AppError } from '../utils/errors.ts';
import { randomToken, safeEqual } from '../utils/crypto.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Ensure the session holds a CSRF token and return it. */
export function ensureCsrfToken(req: Request): string {
  if (!req.session.csrfToken) req.session.csrfToken = randomToken(24);
  return req.session.csrfToken;
}

/**
 * Synchroniser-token CSRF defence for cookie-authenticated requests, layered with an Origin check.
 * The token lives in the server-side session and must be echoed in the X-CSRF-Token header.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin && origin !== env.FRONTEND_ORIGIN) {
    return next(new AppError(403, 'CSRF_ORIGIN', 'Request origin is not allowed.'));
  }
  const expected = req.session?.csrfToken;
  const supplied = req.get('x-csrf-token');
  if (!expected || !supplied || !safeEqual(expected, supplied)) {
    return next(new AppError(403, 'CSRF_TOKEN_INVALID', 'Missing or invalid CSRF token.'));
  }
  next();
}
