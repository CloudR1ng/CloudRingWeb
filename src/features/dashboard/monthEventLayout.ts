import { addDays } from '../../domain/dates';

export type MonthEventLayoutInput = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  allDay?: boolean;
};

export type MonthEventSegment<T extends MonthEventLayoutInput = MonthEventLayoutInput> = {
  event: T;
  startColumn: number;
  endColumn: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
};

export type MonthEventWeek<T extends MonthEventLayoutInput = MonthEventLayoutInput> = {
  startDate: string;
  laneCount: number;
  segments: MonthEventSegment<T>[];
};

/** Calendar end date is inclusive except timed events ending exactly at midnight. */
export function monthEventEndDate(event: MonthEventLayoutInput): string {
  if (!event.allDay && event.endTime === '00:00' && event.endDate > event.startDate) {
    return addDays(event.endDate, -1);
  }
  return event.endDate;
}

/** Split event ranges into week-sized, non-overlapping lanes for the month grid. */
export function layoutMonthEventWeeks<T extends MonthEventLayoutInput>(
  events: readonly T[],
  dates: readonly string[],
): MonthEventWeek<T>[] {
  if (dates.length === 0 || dates.length % 7 !== 0) return [];
  const weeks: MonthEventWeek<T>[] = [];

  for (let offset = 0; offset < dates.length; offset += 7) {
    const weekDates = dates.slice(offset, offset + 7);
    const weekStart = weekDates[0];
    const weekEnd = weekDates[6];
    const candidates = events.flatMap(event => {
      const effectiveEnd = monthEventEndDate(event);
      if (event.startDate > weekEnd || effectiveEnd < weekStart) return [];
      return [{
        event,
        startColumn: Math.max(0, weekDates.indexOf(event.startDate) >= 0 ? weekDates.indexOf(event.startDate) : event.startDate < weekStart ? 0 : 7),
        endColumn: Math.min(6, weekDates.indexOf(effectiveEnd) >= 0 ? weekDates.indexOf(effectiveEnd) : effectiveEnd > weekEnd ? 6 : -1),
        continuesBefore: event.startDate < weekStart,
        continuesAfter: effectiveEnd > weekEnd,
      }];
    }).filter(candidate => candidate.startColumn <= candidate.endColumn)
      .sort((a, b) => a.startColumn - b.startColumn || b.endColumn - a.endColumn || a.event.id.localeCompare(b.event.id));

    const occupied: Array<Array<{ start: number; end: number }>> = [];
    const segments: MonthEventSegment<T>[] = candidates.map(candidate => {
      let lane = occupied.findIndex(intervals => intervals.every(interval => candidate.endColumn < interval.start || candidate.startColumn > interval.end));
      if (lane < 0) { lane = occupied.length; occupied.push([]); }
      occupied[lane].push({ start: candidate.startColumn, end: candidate.endColumn });
      return { ...candidate, lane };
    });
    weeks.push({ startDate: weekStart, laneCount: occupied.length, segments });
  }
  return weeks;
}
