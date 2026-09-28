/**
 * Europe/Brussels calendar helpers for export periods. Days are `YYYY-MM-DD`
 * keys; instants are epoch milliseconds. DST is handled by the i18n
 * conversion, never by adding fixed offsets.
 */
import { brusselsDayKey } from "@cloxa/domain";
import { brusselsLocalToInstant } from "@cloxa/i18n";

export interface ExportPeriod {
  readonly from: string;
  readonly to: string;
}

const DAY_MS = 86_400_000;

/** `day` plus `days` calendar days (UTC date arithmetic on the key itself). */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** Inclusive number of days in a period. */
export function periodLength(period: ExportPeriod): number {
  return (
    (Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`)) /
      DAY_MS +
    1
  );
}

/** The instant a Brussels day starts (23, 24 or 25 hours before the next one). */
export function brusselsDayStart(day: string): number {
  return brusselsLocalToInstant(day, "00:00").getTime();
}

function lastDayOfMonth(year: number, month: number): string {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** Month `YYYY-MM` as a period, cut off at `today` when the month is still running. */
export function monthPeriod(month: string, today: string): ExportPeriod {
  const [year = 0, monthNumber = 1] = month.split("-").map(Number);
  const from = `${month}-01`;
  const end = lastDayOfMonth(year, monthNumber);
  return { from, to: today < end ? today : end };
}

/** `YYYY-MM` of the month before `month`. */
export function previousMonth(month: string): string {
  const [year = 0, monthNumber = 1] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return date.toISOString().slice(0, 7);
}

export interface PeriodQuickPicks {
  readonly previousMonth: ExportPeriod;
  readonly thisMonth: ExportPeriod;
}

/** "Vorige maand" and "Deze maand" (up to today), by the Brussels calendar. */
export function periodQuickPicks(nowMs: number): PeriodQuickPicks {
  const today = brusselsDayKey(nowMs);
  const month = today.slice(0, 7);
  return {
    previousMonth: monthPeriod(previousMonth(month), today),
    thisMonth: monthPeriod(month, today),
  };
}

/** The last `count` months (newest first) as `YYYY-MM`, by the Brussels calendar. */
export function recentMonths(nowMs: number, count: number): string[] {
  const months: string[] = [];
  let month = brusselsDayKey(nowMs).slice(0, 7);
  for (let index = 0; index < count; index += 1) {
    months.push(month);
    month = previousMonth(month);
  }
  return months;
}

const LOCAL_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Brussels",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function localParts(epochMs: number): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const part of LOCAL_PARTS.formatToParts(new Date(epochMs))) {
    parts[part.type] = part.value;
  }
  return parts;
}

/**
 * Brussels wall-clock time with its UTC offset, e.g. `2026-10-25T02:30:00+01:00`.
 * The offset keeps the doubled hour of a fall-back night unambiguous.
 */
export function brusselsIsoLocal(epochMs: number): string {
  const parts = localParts(epochMs);
  const wallMs = Date.UTC(
    Number(parts["year"]),
    Number(parts["month"]) - 1,
    Number(parts["day"]),
    Number(parts["hour"]),
    Number(parts["minute"]),
    Number(parts["second"]),
  );
  const offsetMinutes = Math.round(
    (wallMs - Math.floor(epochMs / 1000) * 1000) / 60_000,
  );
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}T${parts["hour"]}:${parts["minute"]}:${parts["second"]}${offset}`;
}
