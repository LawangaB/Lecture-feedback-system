import { describe, expect, it } from 'vitest';
import { requireTestDatabaseUrl } from '../src/config/test-database.ts';

describe('requireTestDatabaseUrl', () => {
  const localTestDatabase = 'postgresql://lfps_test:test-password@127.0.0.1:5432/lecture_feedback_test?schema=public';

  it('accepts the explicitly named local test database', () => {
    expect(requireTestDatabaseUrl(localTestDatabase)).toBe(localTestDatabase);
    expect(requireTestDatabaseUrl('postgres://lfps_test:test-password@localhost:5432/lecture_feedback_test')).toContain('lecture_feedback_test');
  });

  it('rejects missing and malformed database URLs', () => {
    expect(() => requireTestDatabaseUrl(undefined)).toThrow('TEST_DATABASE_URL is required');
    expect(() => requireTestDatabaseUrl('not a database URL')).toThrow('must be a valid PostgreSQL connection URL');
  });

  it('rejects non-local, non-PostgreSQL, and non-test targets', () => {
    expect(() => requireTestDatabaseUrl('postgresql://user:password@db.example.test:5432/lecture_feedback_test')).toThrow('must target the local lecture_feedback_test database');
    expect(() => requireTestDatabaseUrl('mysql://user:password@localhost:3306/lecture_feedback_test')).toThrow('must target the local lecture_feedback_test database');
    expect(() => requireTestDatabaseUrl('postgresql://user:password@localhost:5432/lecture_feedback')).toThrow('must target the local lecture_feedback_test database');
  });
});
