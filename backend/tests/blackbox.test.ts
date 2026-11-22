/**
 * EC4206 – Member 2: Black-box tests (Equivalence Partitioning, Boundary Value Analysis, Decision Table).
 * Each test name starts with the test-case ID used in the report, so results can be traced row by row.
 * These tests use only the public request schemas / pure functions — no database is needed.
 */
import { describe, expect, it } from 'vitest';
import { emailSchema, passwordSchema, registerBody } from '../src/modules/auth/auth.schemas.ts';
import { createPollBody } from '../src/modules/polls/poll.schemas.ts';
import { joinBody } from '../src/modules/lecture-sessions/session.schemas.ts';
import { submitBody as feedbackBody, listQuery as feedbackListQuery } from '../src/modules/feedback/feedback.schemas.ts';
import { resultsVisibleToStudents } from '../src/modules/polls/poll.dto.ts';

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => schema.safeParse(v).success;
const choicePoll = (options: string[], extra: Record<string, unknown> = {}) => ({ question: 'Which topic was hardest?', type: 'SINGLE_CHOICE', options, ...extra });
const opts = (n: number) => Array.from({ length: n }, (_, i) => `Option ${i + 1}`);

// ───────────────────────────── Equivalence Partitioning ─────────────────────────────

describe('EP-1 Registration password (passwordSchema: 10–128 characters)', () => {
  it('BB-EP-01 valid class: 10–128 chars (nominal 16) is accepted', () => expect(ok(passwordSchema, 'LectureFeed2026!')).toBe(true));
  it('BB-EP-02 invalid class: fewer than 10 chars (5) is rejected', () => expect(ok(passwordSchema, 'abc12')).toBe(false));
  it('BB-EP-03 invalid class: more than 128 chars (200) is rejected', () => expect(ok(passwordSchema, 'a'.repeat(200))).toBe(false));
  it('BB-EP-04 invalid class: empty string is rejected', () => expect(ok(passwordSchema, '')).toBe(false));
  it('BB-EP-05 invalid class: non-string (number) is rejected', () => expect(ok(passwordSchema, 1234567890)).toBe(false));
  // Observation recorded as a finding: there is no class that excludes whitespace-only passwords.
  it('BB-EP-06 whitespace-only password of 10 spaces — system ACCEPTS it (finding F-1)', () => expect(ok(passwordSchema, ' '.repeat(10))).toBe(true));
});

describe('EP-2 Email address (emailSchema: valid format, trimmed + lower-cased, ≤254 chars)', () => {
  it('BB-EP-07 valid class: well-formed address is accepted', () => expect(ok(emailSchema, 'student@uni.ac.lk')).toBe(true));
  it('BB-EP-08 valid class: mixed case with spaces is normalised', () => expect(emailSchema.parse('  Student@UNI.ac.lk ')).toBe('student@uni.ac.lk'));
  it('BB-EP-09 invalid class: missing "@" is rejected', () => expect(ok(emailSchema, 'student.uni.ac.lk')).toBe(false));
  it('BB-EP-10 invalid class: missing domain is rejected', () => expect(ok(emailSchema, 'student@')).toBe(false));
  it('BB-EP-11 invalid class: empty string is rejected', () => expect(ok(emailSchema, '')).toBe(false));
  it('BB-EP-12 invalid class: longer than 254 chars is rejected', () => expect(ok(emailSchema, `${'a'.repeat(250)}@x.lk`)).toBe(false));
  it('BB-EP-13 invalid class: extra unknown field in register body is rejected', () =>
    expect(ok(registerBody, { email: 'a@b.lk', password: 'LectureFeed2026!', displayName: 'A', role: 'ADMIN' })).toBe(false));
});

describe('EP-3 Poll type and answer options (createPollBody)', () => {
  it('BB-EP-14 valid class: SINGLE_CHOICE with 2–10 unique options is accepted', () => expect(ok(createPollBody, choicePoll(opts(4)))).toBe(true));
  it('BB-EP-15 valid class: RATING with no options is accepted', () => expect(ok(createPollBody, { question: 'Rate today', type: 'RATING' })).toBe(true));
  it('BB-EP-16 invalid class: choice poll with fewer than 2 options is rejected', () => expect(ok(createPollBody, choicePoll(['Only one']))).toBe(false));
  it('BB-EP-17 invalid class: choice poll with more than 10 options is rejected', () => expect(ok(createPollBody, choicePoll(opts(12)))).toBe(false));
  it('BB-EP-18 invalid class: duplicate options (case-insensitive) are rejected', () => expect(ok(createPollBody, choicePoll(['Yes', ' yes ']))).toBe(false));
  it('BB-EP-19 invalid class: RATING poll that has options is rejected', () => expect(ok(createPollBody, { question: 'Rate today', type: 'RATING', options: ['1', '2'] })).toBe(false));
  it('BB-EP-20 invalid class: unknown poll type is rejected', () => expect(ok(createPollBody, choicePoll(opts(2), { type: 'ESSAY' }))).toBe(false));
});

// ───────────────────────────── Boundary Value Analysis ─────────────────────────────

describe('BVA-1 Lecture feedback rating (1–5)', () => {
  const cases: [string, number, boolean][] = [
    ['BB-BV-01', 0, false], ['BB-BV-02', 1, true], ['BB-BV-03', 2, true], ['BB-BV-04', 3, true],
    ['BB-BV-05', 4, true], ['BB-BV-06', 5, true], ['BB-BV-07', 6, false],
  ];
  for (const [id, value, valid] of cases) {
    it(`${id} CLARITY rating ${value} → ${valid ? 'accepted' : 'rejected'}`, () =>
      expect(ok(feedbackBody, { ratings: { CLARITY: value }, anonymous: true })).toBe(valid));
  }
  it('BB-BV-08 non-integer rating 4.5 → rejected', () => expect(ok(feedbackBody, { ratings: { PACE: 4.5 }, anonymous: true })).toBe(false));
});

describe('BVA-2 Password length (10–128)', () => {
  const cases: [string, number, boolean][] = [
    ['BB-BV-09', 9, false], ['BB-BV-10', 10, true], ['BB-BV-11', 11, true],
    ['BB-BV-12', 127, true], ['BB-BV-13', 128, true], ['BB-BV-14', 129, false],
  ];
  for (const [id, len, valid] of cases) {
    it(`${id} password of length ${len} → ${valid ? 'accepted' : 'rejected'}`, () => expect(ok(passwordSchema, 'p'.repeat(len))).toBe(valid));
  }
});

describe('BVA-3 Poll question length after trimming (3–500)', () => {
  const cases: [string, number, boolean][] = [
    ['BB-BV-15', 2, false], ['BB-BV-16', 3, true], ['BB-BV-17', 4, true],
    ['BB-BV-18', 499, true], ['BB-BV-19', 500, true], ['BB-BV-20', 501, false],
  ];
  for (const [id, len, valid] of cases) {
    it(`${id} question of length ${len} → ${valid ? 'accepted' : 'rejected'}`, () =>
      expect(ok(createPollBody, choicePoll(opts(2), { question: 'q'.repeat(len) }))).toBe(valid));
  }
  it('BB-BV-21 "  ab  " (2 chars after trim) → rejected', () => expect(ok(createPollBody, choicePoll(opts(2), { question: '  ab  ' }))).toBe(false));
});

describe('BVA-4 Number of answer options for a choice poll (2–10)', () => {
  const cases: [string, number, boolean][] = [
    ['BB-BV-22', 1, false], ['BB-BV-23', 2, true], ['BB-BV-24', 3, true],
    ['BB-BV-25', 9, true], ['BB-BV-26', 10, true], ['BB-BV-27', 11, false],
  ];
  for (const [id, n, valid] of cases) {
    it(`${id} ${n} option(s) → ${valid ? 'accepted' : 'rejected'}`, () => expect(ok(createPollBody, choicePoll(opts(n)))).toBe(valid));
  }
});

describe('BVA-5 Poll timer durationSeconds (5–86 400)', () => {
  const cases: [string, number, boolean][] = [
    ['BB-BV-28', 4, false], ['BB-BV-29', 5, true], ['BB-BV-30', 6, true],
    ['BB-BV-31', 86399, true], ['BB-BV-32', 86400, true], ['BB-BV-33', 86401, false],
  ];
  for (const [id, secs, valid] of cases) {
    it(`${id} durationSeconds ${secs} → ${valid ? 'accepted' : 'rejected'}`, () =>
      expect(ok(createPollBody, choicePoll(opts(2), { durationSeconds: secs }))).toBe(valid));
  }
});

describe('BVA-6 Feedback list pageSize (1–100)', () => {
  const cases: [string, string, boolean][] = [
    ['BB-BV-34', '0', false], ['BB-BV-35', '1', true], ['BB-BV-36', '2', true],
    ['BB-BV-37', '99', true], ['BB-BV-38', '100', true], ['BB-BV-39', '101', false],
  ];
  for (const [id, size, valid] of cases) {
    it(`${id} pageSize=${size} → ${valid ? 'accepted' : 'rejected'}`, () => expect(ok(feedbackListQuery, { pageSize: size })).toBe(valid));
  }
});

describe('BVA-7 Session join code length before normalising (4–16)', () => {
  const cases: [string, number, boolean][] = [
    ['BB-BV-40', 3, false], ['BB-BV-41', 4, true], ['BB-BV-42', 5, true],
    ['BB-BV-43', 15, true], ['BB-BV-44', 16, true], ['BB-BV-45', 17, false],
  ];
  for (const [id, len, valid] of cases) {
    it(`${id} code of length ${len} → ${valid ? 'accepted' : 'rejected'}`, () => expect(ok(joinBody, { code: 'A'.repeat(len) })).toBe(valid));
  }
  // Observation recorded as a finding: the length check runs before separators are stripped.
  it('BB-BV-46 code "- - -" passes validation and normalises to an empty code (finding F-2)', () => {
    const r = joinBody.safeParse({ code: '- - -' });
    expect(r.success).toBe(true);
    expect(r.success && r.data.code).toBe('');
  });
});

// ───────────────────────────── Decision Table ─────────────────────────────
// Feature: can a student see a poll's results?  resultsVisibleToStudents(status, resultsRevealed, resultsVisibility)

describe('DT-1 Student visibility of poll results', () => {
  const rules: [string, string, boolean, string, boolean][] = [
    // id,       status,   revealed, visibility,   expected
    ['BB-DT-R1', 'DRAFT', true, 'LIVE', false], // R1: draft → never visible, even if revealed or LIVE
    ['BB-DT-R2', 'OPEN', true, 'HIDDEN', true], // R2: lecturer revealed manually → visible
    ['BB-DT-R3', 'OPEN', false, 'LIVE', true], // R3: LIVE results → visible while open
    ['BB-DT-R4', 'CLOSED', false, 'AFTER_CLOSE', true], // R4: AFTER_CLOSE and closed → visible
    ['BB-DT-R5', 'OPEN', false, 'AFTER_CLOSE', false], // R5: AFTER_CLOSE but still open → hidden
    ['BB-DT-R6', 'PAUSED', false, 'AFTER_CLOSE', false], // R6: AFTER_CLOSE but paused → hidden
    ['BB-DT-R7', 'CLOSED', false, 'HIDDEN', false], // R7: HIDDEN and not revealed → hidden
  ];
  for (const [id, status, revealed, visibility, expected] of rules) {
    it(`${id} status=${status}, revealed=${revealed}, visibility=${visibility} → ${expected ? 'VISIBLE' : 'HIDDEN'}`, () =>
      expect(resultsVisibleToStudents({ status, resultsRevealed: revealed, resultsVisibility: visibility } as never)).toBe(expected));
  }

  // Exhaustive check: all 4 × 2 × 3 = 24 combinations agree with the collapsed rule set above.
  it('BB-DT-ALL every one of the 24 condition combinations matches the decision table', () => {
    const expected = (s: string, rev: boolean, vis: string) => s !== 'DRAFT' && (rev || vis === 'LIVE' || (vis === 'AFTER_CLOSE' && s === 'CLOSED'));
    let checked = 0;
    for (const s of ['DRAFT', 'OPEN', 'PAUSED', 'CLOSED'])
      for (const rev of [true, false])
        for (const vis of ['HIDDEN', 'LIVE', 'AFTER_CLOSE']) {
          expect(resultsVisibleToStudents({ status: s, resultsRevealed: rev, resultsVisibility: vis } as never)).toBe(expected(s, rev, vis));
          checked++;
        }
    expect(checked).toBe(24);
  });
});
