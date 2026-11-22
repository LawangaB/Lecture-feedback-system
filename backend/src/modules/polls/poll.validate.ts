import type { z } from 'zod';
import { AppError } from '../../utils/errors.ts';
import type { PollRow } from './poll.dto.ts';
import type { submitResponseBody } from './poll.schemas.ts';

export type SubmitInput = z.infer<typeof submitResponseBody>;

/**
 * Checks a student's answer against the poll's own rules before anything is written.
 * Extracted from poll.service.ts (unchanged logic) so it can be unit- and white-box-tested without a database.
 */
export function validateAnswer(poll: PollRow, input: SubmitInput): { optionIds: string[]; ratingValue: number | null } {
  const fail = (message: string) => new AppError(400, 'INVALID_ANSWER', message);
  if (poll.type === 'RATING') {
    if (input.optionIds?.length) throw fail('This poll takes a rating, not options.');
    const min = poll.ratingMin ?? 1;
    const max = poll.ratingMax ?? 5;
    if (input.ratingValue === undefined || input.ratingValue < min || input.ratingValue > max) throw fail(`Choose a rating between ${min} and ${max}.`);
    return { optionIds: [], ratingValue: input.ratingValue };
  }
  if (input.ratingValue !== undefined) throw fail('This poll takes options, not a rating.');
  const ids = input.optionIds ?? [];
  if (new Set(ids).size !== ids.length) throw fail('Each option can only be chosen once.');
  // Option ownership: every id must belong to THIS poll (blocks cross-poll option injection).
  const valid = new Set(poll.options.map((o) => o.id));
  if (ids.some((id) => !valid.has(id))) throw fail('One or more selected options do not belong to this poll.');
  if (poll.type === 'SINGLE_CHOICE') {
    if (ids.length !== 1) throw fail('Choose exactly one option.');
  } else {
    const min = poll.minSelections ?? 1;
    const max = poll.maxSelections ?? poll.options.length;
    if (ids.length < min || ids.length > max) throw fail(`Choose between ${min} and ${max} options.`);
  }
  return { optionIds: ids, ratingValue: null };
}
