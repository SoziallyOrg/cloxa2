/**
 * Brussels calendar helpers shared by the modules. Days are `YYYY-MM-DD`
 * keys in Europe/Brussels (`brusselsDayKey`); a shift belongs to the day it
 * started, like everywhere else in Cloxa.
 */
import { brusselsDayKey, type PlannedBlock, type Shift } from "@cloxa/domain";

import type { PlannedDayBlock } from "./types";

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;

const HOUR_MINUTE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Brussels",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "08:02": the Brussels wall-clock time of an instant. */
export function brusselsHourMinute(epochMs: number): string {
  return HOUR_MINUTE.format(new Date(epochMs));
}

export function yearOf(day: string): number {
  return Number(day.slice(0, 4));
}

/** 1-4. */
export function quarterOf(day: string): number {
  return Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1;
}

/** `YYYY-MM`. */
export function monthOf(day: string): string {
  return day.slice(0, 7);
}

export function shiftDay(shift: Shift): string {
  return brusselsDayKey(shift.start);
}

/**
 * Net worked milliseconds of one shift. A shift (or break) still running is
 * measured up to `now`, like the week total on Uren.
 */
export function workedNetMs(shift: Shift, now: number): number {
  if (!shift.open) return shift.netMs;
  const breakMs = shift.breaks.reduce(
    (sum, brk) => sum + ((brk.end ?? now) - brk.start),
    0,
  );
  return Math.max(0, now - shift.start - breakMs);
}

/** Worked net time per start day, for shifts starting on or before `lastDay`. */
export function workedByDay(
  shifts: readonly Shift[],
  now: number,
  lastDay: string,
): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const shift of shifts) {
    const day = shiftDay(shift);
    if (day > lastDay) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + workedNetMs(shift, now));
  }
  return byDay;
}

export function plannedByDay(
  planned: readonly PlannedDayBlock[],
): Map<string, PlannedBlock[]> {
  const byDay = new Map<string, PlannedBlock[]>();
  for (const block of planned) {
    const list = byDay.get(block.day) ?? [];
    list.push({ start: block.start, end: block.end });
    byDay.set(block.day, list);
  }
  return byDay;
}

export function plannedMs(blocks: readonly PlannedBlock[]): number {
  return blocks.reduce((sum, block) => sum + (block.end - block.start), 0);
}
