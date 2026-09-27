export type ViewMode = 'day' | 'week' | 'month' | 'quarter' | 'half' | 'year';
export const SEOUL_TZ = 'Asia/Seoul';

export function seoulDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: SEOUL_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(date: string, amount: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const value = new Date(Date.UTC(y, m - 1, d + amount));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

export function addMonths(date: string, amount: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + amount, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export function shiftDate(date: string, mode: ViewMode, direction: number): string {
  if (mode === 'day') return addDays(date, direction);
  if (mode === 'week') return addDays(date, direction * 7);
  if (mode === 'month') return addMonths(date, direction);
  if (mode === 'quarter') return addMonths(date, direction * 3);
  if (mode === 'half') return addMonths(date, direction * 6);
  return addMonths(date, direction * 12);
}

export function startOfWeek(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

export function monthDays(date: string): string[] {
  const [year, month] = date.split('-').map(Number);
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const offset = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const total = Math.ceil((offset + count) / 7) * 7;
  return Array.from({ length: total }, (_, i) => addDays(first, i - offset));
}

export function dateLabel(date: string, options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric' }): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('ko-KR', { ...options, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}
