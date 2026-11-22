import { z } from 'zod';

// Request schemas for the feedback routes (moved out of feedback.routes.ts so they can be tested on their own).
export const sessionParams = z.object({ sessionId: z.string().uuid() });
export const rating = z.number().int().min(1).max(5);
export const submitBody = z
  .object({
    ratings: z.object({ CLARITY: rating.optional(), PACE: rating.optional(), ENGAGEMENT: rating.optional(), MATERIALS: rating.optional() }).strict().default({}),
    comment: z.string().max(2000).optional(),
    anonymous: z.boolean(),
  })
  .strict();
const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
export const listQuery = z
  .object({
    dimension: z.enum(['CLARITY', 'PACE', 'ENGAGEMENT', 'MATERIALS']).optional(),
    minRating: z.coerce.number().int().min(1).max(5).optional(),
    maxRating: z.coerce.number().int().min(1).max(5).optional(),
    anonymous: bool.optional(),
    hasComment: bool.optional(),
    includeHidden: bool.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
