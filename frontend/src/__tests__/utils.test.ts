import { describe, expect, it } from 'vitest';
import { formatDateTime } from '@/lib/utils';

describe('formatDateTime', () => {
  it('uses the shared default format options for valid dates and handles absent dates', () => {
    expect(formatDateTime('2026-11-24T12:30:00.000Z')).not.toBe('—');
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
  });
});
