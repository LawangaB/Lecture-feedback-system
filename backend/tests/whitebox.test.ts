/**
 * EC4206 – Member 2: White-box tests for validateAnswer() (src/modules/polls/poll.validate.ts).
 *
 * validateAnswer is the server-side check every poll answer passes before it is stored. Its control-flow graph
 * has 19 nodes and 27 edges, so V(G) = 27 − 19 + 2 = 10 (9 decisions + 1). See the report for the CFG.
 *
 * Tag in each test name:
 *   [SC]  needed for 100 % statement coverage (9 tests)
 *   [BC]  extra test needed for 100 % branch coverage (1 test; together with [SC] = the 10 basis paths)
 *   [CC]  extra tests that exercise each sub-condition of the two compound conditions and the `??` defaults
 */
import { describe, expect, it } from 'vitest';
import { validateAnswer } from '../src/modules/polls/poll.validate.ts';
import { AppError } from '../src/utils/errors.ts';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const FOREIGN = '99999999-9999-4999-8999-999999999999'; // an option id from some other poll

type Over = Partial<{ type: string; ratingMin: number | null; ratingMax: number | null; minSelections: number | null; maxSelections: number | null; options: string[] }>;
const poll = (o: Over = {}) =>
  ({
    type: 'SINGLE_CHOICE', ratingMin: null, ratingMax: null, minSelections: null, maxSelections: null,
    ...o,
    options: (o.options ?? [A, B, C]).map((id, position) => ({ id, label: `Option ${position + 1}`, position })),
  }) as never;
const KEY = { idempotencyKey: 'key-12345' };
/** Runs fn and checks it throws a 400 INVALID_ANSWER AppError with exactly this message. */
const expectInvalid = (fn: () => unknown, message: string) => {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(AppError);
  expect(thrown).toMatchObject({ status: 400, code: 'INVALID_ANSWER', message });
};

describe('validateAnswer – basis paths (statement + branch coverage)', () => {
  it('WB-01 [SC] P1 RATING poll sent option ids → "takes a rating, not options"', () =>
    expectInvalid(() => validateAnswer(poll({ type: 'RATING' }), { ...KEY, optionIds: [A], ratingValue: 3 }), 'This poll takes a rating, not options.'));

  it('WB-02 [SC] P2 RATING poll, rating above max → "Choose a rating between 1 and 5."', () =>
    expectInvalid(() => validateAnswer(poll({ type: 'RATING', ratingMin: 1, ratingMax: 5 }), { ...KEY, ratingValue: 6 }), 'Choose a rating between 1 and 5.'));

  it('WB-03 [SC] P3 RATING poll, valid rating 4 → accepted', () =>
    expect(validateAnswer(poll({ type: 'RATING', ratingMin: 1, ratingMax: 5 }), { ...KEY, ratingValue: 4 })).toEqual({ optionIds: [], ratingValue: 4 }));

  it('WB-04 [SC] P4 choice poll sent a rating → "takes options, not a rating"', () =>
    expectInvalid(() => validateAnswer(poll(), { ...KEY, optionIds: [A], ratingValue: 2 }), 'This poll takes options, not a rating.'));

  it('WB-05 [SC] P5 same option twice → "only be chosen once"', () =>
    expectInvalid(() => validateAnswer(poll({ type: 'MULTIPLE_CHOICE' }), { ...KEY, optionIds: [A, A] }), 'Each option can only be chosen once.'));

  it('WB-06 [SC] P6 option id from another poll → "do not belong to this poll"', () =>
    expectInvalid(() => validateAnswer(poll(), { ...KEY, optionIds: [FOREIGN] }), 'One or more selected options do not belong to this poll.'));

  it('WB-07 [SC] P7 SINGLE_CHOICE with two options → "Choose exactly one option."', () =>
    expectInvalid(() => validateAnswer(poll(), { ...KEY, optionIds: [A, B] }), 'Choose exactly one option.'));

  it('WB-08 [SC] P9 MULTIPLE_CHOICE (1–2) with three options → "Choose between 1 and 2 options."', () =>
    expectInvalid(() => validateAnswer(poll({ type: 'MULTIPLE_CHOICE', minSelections: 1, maxSelections: 2 }), { ...KEY, optionIds: [A, B, C] }), 'Choose between 1 and 2 options.'));

  it('WB-09 [SC] P10 MULTIPLE_CHOICE (1–2) with two options → accepted', () =>
    expect(validateAnswer(poll({ type: 'MULTIPLE_CHOICE', minSelections: 1, maxSelections: 2 }), { ...KEY, optionIds: [A, C] })).toEqual({ optionIds: [A, C], ratingValue: null }));

  it('WB-10 [BC] P8 SINGLE_CHOICE with exactly one option → accepted (false edge of "length !== 1")', () =>
    expect(validateAnswer(poll(), { ...KEY, optionIds: [B] })).toEqual({ optionIds: [B], ratingValue: null }));
});

describe('validateAnswer – sub-conditions and defaults (condition coverage)', () => {
  it('WB-11 [CC] RATING, ratingValue missing → rejected (1st sub-condition: === undefined)', () =>
    expectInvalid(() => validateAnswer(poll({ type: 'RATING' }), { ...KEY }), 'Choose a rating between 1 and 5.'));

  it('WB-12 [CC] RATING, rating below min → rejected (2nd sub-condition: < min)', () =>
    expectInvalid(() => validateAnswer(poll({ type: 'RATING', ratingMin: 1, ratingMax: 5 }), { ...KEY, ratingValue: 0 }), 'Choose a rating between 1 and 5.'));

  it('WB-13 [CC] RATING with null min/max uses defaults 1–5 → 5 accepted', () =>
    expect(validateAnswer(poll({ type: 'RATING' }), { ...KEY, ratingValue: 5 })).toEqual({ optionIds: [], ratingValue: 5 }));

  it('WB-14 [CC] RATING with custom 0–10 scale → 0 accepted', () =>
    expect(validateAnswer(poll({ type: 'RATING', ratingMin: 0, ratingMax: 10 }), { ...KEY, ratingValue: 0 })).toEqual({ optionIds: [], ratingValue: 0 }));

  it('WB-15 [CC] RATING with empty optionIds array is treated as "no options" → accepted', () =>
    expect(validateAnswer(poll({ type: 'RATING' }), { ...KEY, optionIds: [], ratingValue: 3 })).toEqual({ optionIds: [], ratingValue: 3 }));

  it('WB-16 [CC] SINGLE_CHOICE with no optionIds at all → "Choose exactly one option."', () =>
    expectInvalid(() => validateAnswer(poll(), { ...KEY }), 'Choose exactly one option.'));

  it('WB-17 [CC] MULTIPLE_CHOICE below min (2–3, sent 1) → rejected (1st sub-condition: < min)', () =>
    expectInvalid(() => validateAnswer(poll({ type: 'MULTIPLE_CHOICE', minSelections: 2, maxSelections: 3 }), { ...KEY, optionIds: [A] }), 'Choose between 2 and 3 options.'));

  it('WB-18 [CC] MULTIPLE_CHOICE with null min/max defaults to 1..options.length → all 3 accepted', () =>
    expect(validateAnswer(poll({ type: 'MULTIPLE_CHOICE' }), { ...KEY, optionIds: [A, B, C] })).toEqual({ optionIds: [A, B, C], ratingValue: null }));

  it('WB-19 [CC] MULTIPLE_CHOICE with minSelections 0 accepts an empty answer (see finding F-3)', () =>
    expect(validateAnswer(poll({ type: 'MULTIPLE_CHOICE', minSelections: 0, maxSelections: 2 }), { ...KEY, optionIds: [] })).toEqual({ optionIds: [], ratingValue: null }));
});
