import { describe, expect, it } from 'vitest';
import { addDays, addMonths, monthDays, seoulDate } from './dates';

describe('date domain', () => {
  it('clamps month-end shifts and handles leap years', () => {
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2025-01-31', 1)).toBe('2025-02-28');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });
  it('uses the Seoul calendar date across UTC boundaries', () => {
    expect(seoulDate(new Date('2025-12-31T16:00:00.000Z'))).toBe('2026-01-01');
    expect(seoulDate(new Date('2026-01-01T14:59:00.000Z'))).toBe('2026-01-01');
  });
  it('builds a Monday-first calendar grid including leap day', () => {
    const days = monthDays('2024-02-15');
    expect(days[0]).toBe('2024-01-29');
    expect(days).toContain('2024-02-29');
    expect(days.length % 7).toBe(0);
  });
});
