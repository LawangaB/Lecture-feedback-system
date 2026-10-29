import { z } from 'zod';

const optionLabel = z.string().trim().min(1, 'Option text is required.').max(300);

const pollFields = {
  question: z.string().trim().min(3, 'Ask a question of at least 3 characters.').max(500),
  type: z.enum(['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'RATING']),
  options: z.array(optionLabel).max(10).default([]),
  isAnonymous: z.boolean().default(true),
  allowResponseUpdate: z.boolean().default(false),
  isRequired: z.boolean().default(false),
  resultsVisibility: z.enum(['HIDDEN', 'LIVE', 'AFTER_CLOSE']).default('AFTER_CLOSE'),
  minSelections: z.number().int().min(0).max(10).nullish(),
  maxSelections: z.number().int().min(1).max(10).nullish(),
  ratingMin: z.number().int().min(0).max(1).nullish(),
  ratingMax: z.number().int().min(2).max(10).nullish(),
  durationSeconds: z.number().int().min(5).max(86400).nullish(),
};

/** Cross-field rules shared by create and update. Returns issues via ctx. */
function refinePoll(v: { type: string; options: string[]; isAnonymous: boolean; allowResponseUpdate: boolean; minSelections?: number | null; maxSelections?: number | null; ratingMin?: number | null; ratingMax?: number | null }, ctx: z.RefinementCtx) {
  if (v.type === 'RATING') {
    if (v.options.length > 0) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Rating polls do not use answer options.' });
    const min = v.ratingMin ?? 1;
    const max = v.ratingMax ?? 5;
    if (max <= min) ctx.addIssue({ code: 'custom', path: ['ratingMax'], message: 'Maximum must be greater than minimum.' });
  } else {
    if (v.options.length < 2) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Add at least two answer options.' });
    const seen = new Set<string>();
    v.options.forEach((label, i) => {
      const k = label.trim().toLowerCase();
      if (seen.has(k)) ctx.addIssue({ code: 'custom', path: ['options', i], message: 'Answer options must be unique.' });
      seen.add(k);
    });
  }
  if (v.type === 'MULTIPLE_CHOICE') {
    const min = v.minSelections ?? 1;
    const max = v.maxSelections ?? v.options.length;
    if (min > max) ctx.addIssue({ code: 'custom', path: ['minSelections'], message: 'Minimum selections cannot exceed maximum.' });
    if (max > v.options.length) ctx.addIssue({ code: 'custom', path: ['maxSelections'], message: 'Maximum selections cannot exceed the number of options.' });
  }
  if (v.isAnonymous && v.allowResponseUpdate) {
    // Anonymous answers are deliberately unlinkable to a user, so there is nothing to update.
    ctx.addIssue({ code: 'custom', path: ['allowResponseUpdate'], message: 'Anonymous polls cannot allow answer changes.' });
  }
}

export const createPollBody = z.object(pollFields).strict().superRefine(refinePoll);
export const updatePollBody = createPollBody; // full replacement of a draft

export const submitResponseBody = z
  .object({
    optionIds: z.array(z.string().uuid()).max(10).optional(),
    ratingValue: z.number().int().min(0).max(10).optional(),
    idempotencyKey: z.string().min(8).max(100).regex(/^[A-Za-z0-9._-]+$/),
  })
  .strict();

export const sessionIdParams = z.object({ sessionId: z.string().uuid() });
export const pollIdParams = z.object({ pollId: z.string().uuid() });
