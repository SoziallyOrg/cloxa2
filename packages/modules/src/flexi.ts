/**
 * Flexi-jobs (legal-notes §1.6): with an oral contract the Dimona is made per
 * day, with the start and end hour. This module shows the start, end and net
 * time per day, and notes when the real start or end differs from the
 * planned block by more than 15 minutes: a prompt to check, never a verdict.
 */
import { z } from "zod";

import {
  brusselsHourMinute,
  MINUTE_MS,
  plannedByDay,
  shiftDay,
  workedNetMs,
} from "./calendar";
import type { PlannedBlock, Shift } from "@cloxa/domain";
import type {
  Counter,
  ExportDayInput,
  Hint,
  ModuleDefinition,
  ModuleInput,
} from "./types";

/** More than this between planned and real start (or end) is worth a look. */
export const FLEXI_TOLERANCE_MS = 15 * MINUTE_MS;
const MAX_DAYS = 7;
const MAX_HINTS = 5;

type DiffPart = "start" | "end" | "both";

interface DayComparison {
  readonly plannedStart: number;
  readonly plannedEnd: number;
  readonly part: DiffPart | null;
}

/** Null when the day has no plan or no shift: nothing to compare. */
export function compareWithPlan(
  shifts: readonly Shift[],
  planned: readonly PlannedBlock[],
): DayComparison | null {
  const first = shifts[0];
  const last = shifts.at(-1);
  if (first === undefined || last === undefined || planned.length === 0) return null;
  const plannedStart = Math.min(...planned.map((block) => block.start));
  const plannedEnd = Math.max(...planned.map((block) => block.end));
  const startDiffers = Math.abs(first.start - plannedStart) > FLEXI_TOLERANCE_MS;
  const endDiffers =
    last.end !== null && Math.abs(last.end - plannedEnd) > FLEXI_TOLERANCE_MS;
  const part: DiffPart | null =
    startDiffers && endDiffers
      ? "both"
      : startDiffers
        ? "start"
        : endDiffers
          ? "end"
          : null;
  return { plannedStart, plannedEnd, part };
}

/** The period's days with a shift, newest first, each with its shifts in order. */
function daysWithShifts(input: ModuleInput): [string, Shift[]][] {
  const byDay = new Map<string, Shift[]>();
  for (const shift of [...input.shifts].sort((a, b) => a.start - b.start)) {
    const day = shiftDay(shift);
    if (day < input.period.from || day > input.period.to) continue;
    const list = byDay.get(day) ?? [];
    list.push(shift);
    byDay.set(day, list);
  }
  return [...byDay.entries()].sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0));
}

function counters(input: ModuleInput): readonly Counter[] {
  return daysWithShifts(input)
    .slice(0, MAX_DAYS)
    .map(([day, shifts]) => {
      const first = shifts[0]!;
      const last = shifts.at(-1)!;
      const net = shifts.reduce(
        (sum, shift) => sum + workedNetMs(shift, input.period.now),
        0,
      );
      return {
        id: `flexi.day.${day}`,
        display: "row",
        label: { key: "modules.flexi.dayLabel", values: { day: { day } } },
        value:
          last.end === null
            ? {
                key: "modules.flexi.dayValueOpen",
                values: { start: { time: first.start } },
              }
            : {
                key: "modules.flexi.dayValue",
                values: {
                  range: `${brusselsHourMinute(first.start)}–${brusselsHourMinute(last.end)}`,
                  net: { durationMs: net },
                },
              },
      } satisfies Counter;
    });
}

function hints(input: ModuleInput): readonly Hint[] {
  const planned = plannedByDay(input.planned);
  const result: Hint[] = [];
  for (const [day, shifts] of daysWithShifts(input)) {
    const comparison = compareWithPlan(shifts, planned.get(day) ?? []);
    if (comparison?.part == null) continue;
    result.push({
      id: `flexi.differs.${day}`,
      tone: "attention",
      message: {
        key:
          input.audience === "manager"
            ? "modules.flexi.hintDiffersManager"
            : "modules.flexi.hintDiffersEmployee",
        values: {
          day: { day },
          part: comparison.part,
          planned: `${brusselsHourMinute(comparison.plannedStart)}–${brusselsHourMinute(comparison.plannedEnd)}`,
        },
      },
    });
    if (result.length === MAX_HINTS) break;
  }
  return result;
}

export const flexi: ModuleDefinition = {
  id: "flexi",
  label: "modules.flexi.label",
  description: "modules.flexi.description",
  statutes: ["flexi"],
  configChoices: [],
  configSchema: z.strictObject({}),
  employeeFields: null,
  fields: [],
  needsYearToDate: false,
  counters,
  hints,
  exportColumns: [
    {
      key: "planned_start_local",
      header: "modules.flexi.csvPlannedStart",
      kind: "text",
    },
    { key: "planned_end_local", header: "modules.flexi.csvPlannedEnd", kind: "text" },
    {
      key: "differs_from_planned",
      header: "modules.flexi.csvDiffers",
      kind: "boolean",
    },
  ],
  exportValues(input: ExportDayInput) {
    if (input.planned.length === 0) {
      return {
        planned_start_local: null,
        planned_end_local: null,
        differs_from_planned: null,
      };
    }
    const plannedStart = Math.min(...input.planned.map((block) => block.start));
    const plannedEnd = Math.max(...input.planned.map((block) => block.end));
    const comparison = compareWithPlan(
      [...input.shifts].sort((a, b) => a.start - b.start),
      input.planned,
    );
    return {
      planned_start_local: brusselsHourMinute(plannedStart),
      planned_end_local: brusselsHourMinute(plannedEnd),
      differs_from_planned: comparison === null ? null : comparison.part !== null,
    };
  },
};
