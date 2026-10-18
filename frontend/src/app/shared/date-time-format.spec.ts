import { describe, expect, it } from 'vitest';

import { formatDate, formatDateTime, formatTime } from './date-time-format';

describe('date and time formatting', () => {
  it('formats calendar dates as DD.MM.YYYY without shifting the day', () => {
    expect(formatDate('2026-10-18')).toBe('18.10.2026');
  });

  it('formats times in a zero-padded 24-hour format', () => {
    expect(formatTime('09:05')).toBe('09:05');
    expect(formatTime('14:05')).toBe('14:05');
    expect(formatTime('23:45')).toBe('23:45');
  });

  it('formats date-time values with the same date and time rules', () => {
    const value = new Date(2026, 9, 18, 15, 5);
    expect(formatDateTime(value)).toBe('18.10.2026 15:05');
  });

  it('returns an empty string for missing or invalid values', () => {
    expect(formatDate(null)).toBe('');
    expect(formatTime('25:00')).toBe('');
    expect(formatDate('2026-02-30')).toBe('');
    expect(formatDateTime('not-a-date')).toBe('');
  });
});
