import { z } from 'zod';
import { normalizeJoinCode } from '../../utils/crypto.ts';

export const createSessionBody = z
  .object({
    title: z.string().trim().min(2).max(160),
    description: z.string().trim().max(2000).optional(),
    scheduledFor: z.coerce.date().optional(),
    accessPolicy: z.enum(['ENROLLED_ONLY', 'ANY_SIGNED_IN']).default('ENROLLED_ONLY'),
    feedbackEnabled: z.boolean().default(true),
  })
  .strict();
export const updateSessionBody = createSessionBody.partial().strict();
export const joinBody = z.object({ code: z.string().trim().min(4).max(16).transform(normalizeJoinCode) }).strict();
export const sessionParams = z.object({ sessionId: z.string().uuid() });
export const courseParams = z.object({ courseId: z.string().uuid() });
