import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../src/utils/csv.ts';
import { generateJoinCode, hashJoinCode, normalizeJoinCode, encryptText, decryptText } from '../src/utils/crypto.ts';
import { createPollBody, submitResponseBody } from '../src/modules/polls/poll.schemas.ts';
import { resultsVisibleToStudents } from '../src/modules/polls/poll.dto.ts';

describe('csv safety', () => {
  it('neutralises formula-leading characters', () => {
    for (const lead of ['=', '+', '-', '@']) expect(csvCell(`${lead}SUM(A1)`).startsWith("'")).toBe(true);
    expect(csvCell('\t=cmd')).toBe("'\t=cmd");
  });
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });
  it('keeps numbers numeric and escapes a formula that also needs quoting', () => {
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell('=1,2')).toBe('"\'=1,2"');
    expect(toCsv([['a', 1], ['b', null]])).toBe('a,1\r\nb,\r\n');
  });
});

describe('join codes', () => {
  it('generates unambiguous 6-char codes', () => {
    for (let i = 0; i < 200; i++) expect(generateJoinCode()).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
  });
  it('normalises case and separators before hashing', () => {
    expect(normalizeJoinCode(' ab-7k q9 ')).toBe('AB7KQ9');
    expect(hashJoinCode('ab7kq9')).toBe(hashJoinCode('AB7-KQ9'));
    expect(hashJoinCode('AB7KQ9')).not.toBe(hashJoinCode('AB7KQ8'));
  });
  it('round-trips encrypted codes and rejects tampering', () => {
    const blob = encryptText('AB7KQ9');
    expect(decryptText(blob)).toBe('AB7KQ9');
    expect(decryptText(blob.slice(0, -2) + 'xx')).toBeNull();
  });
});

describe('poll creation rules', () => {
  const ok = { question: 'Pick one', type: 'SINGLE_CHOICE', options: ['A', 'B'] };
  it('accepts a valid single-choice poll with secure defaults', () => {
    const p = createPollBody.parse(ok);
    expect(p.isAnonymous).toBe(true);
    expect(p.resultsVisibility).toBe('AFTER_CLOSE');
    expect(p.allowResponseUpdate).toBe(false);
  });
  it('rejects too few, duplicate (case-insensitive) and blank options', () => {
    expect(createPollBody.safeParse({ ...ok, options: ['A'] }).success).toBe(false);
    expect(createPollBody.safeParse({ ...ok, options: ['A', ' a '] }).success).toBe(false);
    expect(createPollBody.safeParse({ ...ok, options: ['A', '  '] }).success).toBe(false);
  });
  it('rejects anonymous polls that allow answer changes', () => {
    expect(createPollBody.safeParse({ ...ok, isAnonymous: true, allowResponseUpdate: true }).success).toBe(false);
    expect(createPollBody.safeParse({ ...ok, isAnonymous: false, allowResponseUpdate: true }).success).toBe(true);
  });
  it('validates multiple-choice bounds and rating ranges', () => {
    const multi = { question: 'Pick', type: 'MULTIPLE_CHOICE', options: ['A', 'B', 'C'] };
    expect(createPollBody.safeParse({ ...multi, minSelections: 3, maxSelections: 2 }).success).toBe(false);
    expect(createPollBody.safeParse({ ...multi, maxSelections: 4 }).success).toBe(false);
    expect(createPollBody.safeParse({ ...multi, minSelections: 1, maxSelections: 2 }).success).toBe(true);
    expect(createPollBody.safeParse({ question: 'Rate', type: 'RATING', options: ['x'] }).success).toBe(false);
    expect(createPollBody.safeParse({ question: 'Rate', type: 'RATING', ratingMin: 1, ratingMax: 1 }).success).toBe(false);
    expect(createPollBody.safeParse({ question: 'Rate', type: 'RATING', ratingMin: 1, ratingMax: 5 }).success).toBe(true);
  });
  it('rejects unknown fields (mass assignment)', () => {
    expect(createPollBody.safeParse({ ...ok, createdById: 'x', status: 'OPEN' }).success).toBe(false);
    expect(submitResponseBody.safeParse({ optionIds: [], idempotencyKey: 'abcdefgh', userId: 'x' }).success).toBe(false);
  });
});

describe('student result visibility', () => {
  const p = (status: string, resultsVisibility: string, resultsRevealed = false) => ({ status, resultsVisibility, resultsRevealed }) as never;
  it('follows the lecturer settings', () => {
    expect(resultsVisibleToStudents(p('OPEN', 'HIDDEN'))).toBe(false);
    expect(resultsVisibleToStudents(p('OPEN', 'LIVE'))).toBe(true);
    expect(resultsVisibleToStudents(p('OPEN', 'AFTER_CLOSE'))).toBe(false);
    expect(resultsVisibleToStudents(p('CLOSED', 'AFTER_CLOSE'))).toBe(true);
    expect(resultsVisibleToStudents(p('CLOSED', 'HIDDEN'))).toBe(false);
    expect(resultsVisibleToStudents(p('CLOSED', 'HIDDEN', true))).toBe(true);
    expect(resultsVisibleToStudents(p('DRAFT', 'LIVE', true))).toBe(false);
  });
});
