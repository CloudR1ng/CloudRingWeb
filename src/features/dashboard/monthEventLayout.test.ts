import { describe, expect, it } from 'vitest';
import { layoutMonthEventWeeks, monthEventEndDate } from './monthEventLayout';

const dates = Array.from({ length: 42 }, (_, i) => {
  const date = new Date(Date.UTC(2026, 7, 31 + i));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
});
const event = (id: string, startDate: string, endDate: string, extra: { allDay?: boolean; endTime?: string } = {}) => ({ id, title: id, startDate, endDate, ...extra });

describe('monthly multi-day event bars', () => {
  it('splits ranges at week boundaries with continuation flags', () => {
    const [first, second] = layoutMonthEventWeeks([event('span', '2026-09-04', '2026-09-09')], dates);
    expect(first.segments[0]).toMatchObject({ startColumn: 4, endColumn: 6, continuesBefore: false, continuesAfter: true, lane: 0 });
    expect(second.segments[0]).toMatchObject({ startColumn: 0, endColumn: 2, continuesBefore: true, continuesAfter: false, lane: 0 });
  });

  it('assigns separate lanes to overlapping events and reuses lanes when ranges do not overlap', () => {
    const weeks = layoutMonthEventWeeks([
      event('a', '2026-09-01', '2026-09-03'),
      event('b', '2026-09-02', '2026-09-04'),
      event('c', '2026-09-05', '2026-09-06'),
    ], dates);
    expect(weeks[0].segments.map(item => [item.event.id, item.lane])).toEqual([['a', 0], ['b', 1], ['c', 0]]);
    expect(weeks[0].laneCount).toBe(2);
  });

  it('keeps all-day end dates inclusive and treats timed midnight ends as exclusive', () => {
    expect(monthEventEndDate(event('all-day', '2026-09-27', '2026-09-28', { allDay: true, endTime: '00:00' }))).toBe('2026-09-28');
    expect(monthEventEndDate(event('timed', '2026-09-27', '2026-09-28', { endTime: '00:00' }))).toBe('2026-09-27');
    expect(layoutMonthEventWeeks([event('timed', '2026-09-27', '2026-09-28', { endTime: '00:00' })], dates)[4].segments).toHaveLength(0);
  });

  it('splits events spanning multiple weeks into independently laid out segments', () => {
    const weeks = layoutMonthEventWeeks([event('long', '2026-09-01', '2026-09-24')], dates);
    const segments = weeks.flatMap(week => week.segments.map(segment => ({ week: week.startDate, ...segment })));
    expect(segments).toHaveLength(4);
    expect(segments.map(segment => [segment.continuesBefore, segment.continuesAfter])).toEqual([
      [false, true], [true, true], [true, true], [true, false],
    ]);
  });
});
