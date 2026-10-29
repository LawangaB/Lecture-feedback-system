import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { AppError } from '../utils/errors.ts';

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Validates and replaces body/query/params with the parsed values.
 * Body schemas should be .strict() so unexpected fields (mass assignment) are rejected.
 */
export const validate =
  (schemas: Schemas) => (req: Request, _res: Response, next: NextFunction) => {
    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part]);
      if (!result.success) {
        const fields = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
        return next(new AppError(400, 'VALIDATION_ERROR', 'The request is invalid.', { fields }));
      }
      if (part === 'query') {
        Object.defineProperty(req, 'query', { value: result.data, writable: true, configurable: true });
      } else {
        (req as unknown as Record<string, unknown>)[part] = result.data as z.infer<typeof schema>;
      }
    }
    next();
  };
