import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(128, 'Use at most 128 characters.');

export const registerBody = z
  .object({ email: emailSchema, password: passwordSchema, displayName: z.string().trim().min(1).max(100) })
  .strict();
export const loginBody = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).strict();
export const forgotBody = z.object({ email: emailSchema }).strict();
export const resetBody = z.object({ token: z.string().min(20).max(200), newPassword: passwordSchema }).strict();
export const changePasswordBody = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }).strict();
export const updateProfileBody = z.object({ displayName: z.string().trim().min(1).max(100) }).strict();
