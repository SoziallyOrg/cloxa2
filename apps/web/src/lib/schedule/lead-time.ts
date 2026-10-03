/**
 * The "7 working days" heads-up for part-time schedules (`docs/legal-notes.md`
 * §1.2): informational only, never blocking. Belgian public holidays are
 * intentionally **not** subtracted here — a small business doesn't need a
 * holiday calendar to save a schedule, and the copy only ever says
 * "werkdagen" (Mon-Fri), never claims legal certainty. Pure date-key math
 * (no timezone conversion): `valid_from` is a plain SQL `date`, and callers
 * pass Brussels-local day keys (`brusselsDayKey`) for "today".
 */

export const SCHEDULE_LEAD_TIME_WORKING_DAYS = 7;

function toUtcDate(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00Z`);
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Counts Mon-Fri days strictly after `todayKey` up to and including
 * `validFromKey`. Zero when `validFromKey` is today or earlier.
 */
export function countWorkingDaysUntil(todayKey: string, validFromKey: string): number {
  const today = toUtcDate(todayKey);
  const validFrom = toUtcDate(validFromKey);
  let count = 0;
  const cursor = new Date(today);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor <= validFrom) {
    if (!isWeekend(cursor)) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

/** True when fewer than 7 working days separate today from `validFromKey`. */
export function isLeadTimeShort(todayKey: string, validFromKey: string): boolean {
  return (
    countWorkingDaysUntil(todayKey, validFromKey) < SCHEDULE_LEAD_TIME_WORKING_DAYS
  );
}

/** The closest Monday strictly after `todayKey` (never today itself). */
export function nextMonday(todayKey: string): string {
  const today = toUtcDate(todayKey);
  const cursor = new Date(today);
  do {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  } while (cursor.getUTCDay() !== 1);
  return cursor.toISOString().slice(0, 10);
}
