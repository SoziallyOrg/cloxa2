/**
 * Indicative week total: net worked time for shifts starting in the current
 * Europe/Brussels week (Monday 00:00 up to, but excluding, next Monday
 * 00:00). Pure and testable without a DOM.
 */
import { brusselsLocalToInstant } from "@cloxa/i18n";
import type { Shift } from "@cloxa/domain";

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Brussels",
  weekday: "short",
});

const ISO_WEEKDAY: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

const DAY_KEY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Brussels",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days));
  return DAY_KEY_FORMATTER.format(shifted);
}

export interface BrusselsWeekRange {
  /** Monday 00:00 local, as an instant. */
  readonly start: number;
  /** Next Monday 00:00 local, as an instant (exclusive). */
  readonly end: number;
}

/** The Europe/Brussels calendar week (Mon-Sun) containing `now`. */
export function brusselsWeekRange(now: number): BrusselsWeekRange {
  const todayKey = DAY_KEY_FORMATTER.format(new Date(now));
  const weekday = ISO_WEEKDAY[WEEKDAY_FORMATTER.format(new Date(now))] ?? 1;
  const mondayKey = addDaysToDateKey(todayKey, -(weekday - 1));
  const nextMondayKey = addDaysToDateKey(mondayKey, 7);
  return {
    start: brusselsLocalToInstant(mondayKey, "00:00").getTime(),
    end: brusselsLocalToInstant(nextMondayKey, "00:00").getTime(),
  };
}

/**
 * Net worked milliseconds of one shift. An open shift (and an open break) is
 * measured up to `now`.
 */
export function workedMs(shift: Shift, now: number): number {
  if (!shift.open) return shift.netMs;
  const breakMs = shift.breaks.reduce(
    (sum, brk) => sum + ((brk.end ?? now) - brk.start),
    0,
  );
  return Math.max(0, now - shift.start - breakMs);
}

/**
 * Net worked milliseconds for shifts starting in the current week. Open
 * shifts and open breaks are measured up to `now`.
 */
export function weekTotalMs(shifts: readonly Shift[], now: number): number {
  const { start, end } = brusselsWeekRange(now);
  let total = 0;

  for (const shift of shifts) {
    if (shift.start < start || shift.start >= end) continue;
    total += workedMs(shift, now);
  }

  return total;
}
