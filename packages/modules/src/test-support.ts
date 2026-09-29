/** Test helpers: Brussels wall times to shifts and planned blocks. */
import {
  deriveShifts,
  type ClockEvent,
  type Shift,
  type WorkLocation,
} from "@cloxa/domain";
import { brusselsLocalToInstant } from "@cloxa/i18n";

import type { ModuleInput, Period, PlannedDayBlock } from "./types";

export const HOUR = 3600_000;

export const at = (day: string, time: string): number =>
  brusselsLocalToInstant(day, time).getTime();

let counter = 0;
const nextId = () => `ev-${(counter += 1)}`;

/**
 * One shift on `day` from `start` to `end` (Brussels; an earlier end is the
 * next day), still running when `end` is null. A break starts an hour in.
 */
export function shift(
  day: string,
  start: string,
  end: string | null,
  options: { breakMinutes?: number; workLocation?: WorkLocation } = {},
): Shift {
  const base = { employeeId: "e1", siteId: "s1", source: "app" as const };
  const startAt = at(day, start);
  const events: ClockEvent[] = [
    {
      ...base,
      id: nextId(),
      type: "clock_in",
      occurredAt: startAt,
      ...(options.workLocation ? { workLocation: options.workLocation } : {}),
    },
  ];
  if (options.breakMinutes) {
    const breakStart = startAt + HOUR;
    events.push({ ...base, id: nextId(), type: "break_start", occurredAt: breakStart });
    events.push({
      ...base,
      id: nextId(),
      type: "break_end",
      occurredAt: breakStart + options.breakMinutes * 60_000,
    });
  }
  if (end !== null) {
    const endAt = at(day, end);
    events.push({
      ...base,
      id: nextId(),
      type: "clock_out",
      occurredAt: endAt < startAt ? endAt + 24 * HOUR : endAt,
    });
  }
  const [result] = deriveShifts(events);
  if (!result) throw new Error("no shift");
  return result;
}

export function block(day: string, start: string, end: string): PlannedDayBlock {
  return { day, start: at(day, start), end: at(day, end) };
}

export function input(
  overrides: Partial<ModuleInput> & { period: Period },
): ModuleInput {
  return {
    shifts: [],
    planned: [],
    config: {},
    data: null,
    audience: "manager",
    ...overrides,
  };
}
