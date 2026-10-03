/**
 * Calendar week (Monday-Sunday) ranges for the employee's "Mijn rooster"
 * section. Pure date-key math, like `lead-time.ts`.
 */

function toUtcDate(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00Z`);
}

function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(dayKey: string, days: number): string {
  const date = toUtcDate(dayKey);
  date.setUTCDate(date.getUTCDate() + days);
  return toDayKey(date);
}

/** Monday on or before `dayKey` (Monday = 1, ..., Sunday = 7 for the math). */
export function mondayOfWeek(dayKey: string): string {
  const isoDay = toUtcDate(dayKey).getUTCDay() || 7;
  return addDays(dayKey, 1 - isoDay);
}

export interface WeekRange {
  readonly from: string;
  readonly to: string;
}

/** The Monday-Sunday week containing `todayKey`. */
export function thisWeekRange(todayKey: string): WeekRange {
  const monday = mondayOfWeek(todayKey);
  return { from: monday, to: addDays(monday, 6) };
}

/** The Monday-Sunday week right after `todayKey`'s week. */
export function nextWeekRange(todayKey: string): WeekRange {
  const monday = addDays(mondayOfWeek(todayKey), 7);
  return { from: monday, to: addDays(monday, 6) };
}
