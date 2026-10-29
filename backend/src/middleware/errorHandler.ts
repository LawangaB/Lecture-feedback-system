import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.ts';
import { logger } from '../utils/logger.ts';
import { isProd } from '../config/env.ts';

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, 'NOT_FOUND', 'Route not found.'));
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = req.requestId ?? 'unknown';
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong on our side.';
  let details: unknown;

  if (err instanceof AppError) {
    status = err.status;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'The request is invalid.';
    details = { fields: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
  } else if (typeof err === 'object' && err && 'type' in err && (err as { type: string }).type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'The request body is too large.';
  } else if (err instanceof SyntaxError && 'body' in err) {
    status = 400;
    code = 'INVALID_JSON';
    message = 'The request body is not valid JSON.';
  }

  if (status >= 500) {
    logger.error({ err, requestId, path: req.path }, 'unhandled error');
  }
  // Generic messages in production; no stack traces or internals are ever sent to clients.
  if (status >= 500 && isProd) message = 'Something went wrong on our side.';
  res.status(status).json({ error: { code, message, requestId, ...(details ? { details } : {}) } });
}
