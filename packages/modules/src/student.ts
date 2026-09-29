/**
 * Students (legal-notes §1.8): 650 hours per calendar year at reduced
 * contributions, and a Dimona STU with the planned hours per quarter. The
 * counter adds the hours worked here to the hours elsewhere the employer
 * read on Student@work, if that reading is from the same year. Indicative:
 * Student@work holds the real balance.
 */
import { z } from "zod";

import {
  HOUR_MS,
  plannedByDay,
  plannedMs,
  quarterOf,
  workedByDay,
  yearOf,
} from "./calendar";
import type {
  Counter,
  ExportDayInput,
  Hint,
  Message,
  ModuleDefinition,
  ModuleInput,
} from "./types";

export const STUDENT_CONTINGENT_HOURS = 650;
const CONTINGENT_MS = STUDENT_CONTINGENT_HOURS * HOUR_MS;
/** Below this many hours left, the hint points to Student@work. */
const LOW_REMAINING_MS = 50 * HOUR_MS;

export const studentData = z
  .strictObject({
    /** Hours worked for other employers this year, as Student@work showed them. */
    hours_elsewhere: z
      .number()
      .min(0)
      .max(2000)
      .refine((hours) => Number.isInteger(hours * 100), "at most two decimals")
      .optional(),
    /** The day the employer read that balance. */
    checked_on: z.iso.date().optional(),
  })
  .refine(
    (data) => (data.hours_elsewhere === undefined) === (data.checked_on === undefined),
    { message: "hours and date go together", path: ["checked_on"] },
  );
export type StudentData = z.output<typeof studentData>;

function parseData(raw: unknown): StudentData | null {
  const parsed = studentData.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

interface YearTally {
  readonly year: number;
  readonly workedMs: number;
  readonly elsewhereMs: number;
  readonly totalMs: number;
  /** The year of an older Student@work reading that was left out. */
  readonly staleYear: number | null;
  readonly checkedOn: string | null;
  readonly elsewhereHours: number | null;
}

function tally(input: ModuleInput): YearTally {
  const year = yearOf(input.period.to);
  let workedMs = 0;
  for (const [day, ms] of workedByDay(
    input.shifts,
    input.period.now,
    input.period.to,
  )) {
    if (yearOf(day) === year) workedMs += ms;
  }
  const data = parseData(input.data);
  let elsewhereMs = 0;
  let staleYear: number | null = null;
  let elsewhereHours: number | null = null;
  if (data?.hours_elsewhere !== undefined && data.checked_on !== undefined) {
    if (yearOf(data.checked_on) === year) {
      elsewhereHours = data.hours_elsewhere;
      elsewhereMs = Math.round(data.hours_elsewhere * HOUR_MS);
    } else {
      staleYear = yearOf(data.checked_on);
    }
  }
  return {
    year,
    workedMs,
    elsewhereMs,
    totalMs: workedMs + elsewhereMs,
    staleYear,
    checkedOn: elsewhereHours === null ? null : (data?.checked_on ?? null),
    elsewhereHours,
  };
}

function counters(input: ModuleInput): readonly Counter[] {
  const result = tally(input);
  const lines: Message[] = [
    result.totalMs > CONTINGENT_MS
      ? {
          key: "modules.student.over",
          values: { over: { durationMs: result.totalMs - CONTINGENT_MS } },
        }
      : {
          key: "modules.student.remaining",
          values: { remaining: { durationMs: CONTINGENT_MS - result.totalMs } },
        },
  ];
  if (result.elsewhereHours !== null && result.checkedOn !== null) {
    lines.push({
      key: "modules.student.elsewhere",
      values: {
        hours: { durationMs: result.elsewhereMs },
        date: { day: result.checkedOn },
      },
    });
  }
  if (result.staleYear !== null) {
    lines.push({
      key: "modules.student.elsewhereStale",
      values: { year: result.staleYear },
    });
  }

  const year: Counter = {
    id: "student.year",
    display: "figure",
    label: { key: "modules.student.yearLabel", values: { year: result.year } },
    value: { key: "modules.value", values: { value: { durationMs: result.totalMs } } },
    progress: {
      value: result.totalMs,
      max: CONTINGENT_MS,
      label: { key: "modules.student.progressLabel" },
      start: { key: "modules.student.progressStart" },
      end: { key: "modules.student.progressEnd" },
    },
    lines,
  };

  // Dimona STU: the planned hours of each quarter so far (the whole quarter),
  // against the hours worked in it up to now.
  const lastQuarter = quarterOf(input.period.to);
  const planned = plannedByDay(input.planned);
  const worked = workedByDay(input.shifts, input.period.now, input.period.to);
  const quarters: Counter[] = [];
  for (let quarter = 1; quarter <= lastQuarter; quarter += 1) {
    const inQuarter = (day: string) =>
      yearOf(day) === result.year && quarterOf(day) === quarter;
    let plannedTotal = 0;
    for (const [day, blocks] of planned) {
      if (inQuarter(day)) plannedTotal += plannedMs(blocks);
    }
    let workedTotal = 0;
    for (const [day, ms] of worked) {
      if (inQuarter(day)) workedTotal += ms;
    }
    quarters.push({
      id: `student.quarter.${quarter}`,
      display: "row",
      label: { key: "modules.student.quarterLabel", values: { quarter } },
      value: {
        key: "modules.student.quarterValue",
        values: {
          planned: { durationMs: plannedTotal },
          worked: { durationMs: workedTotal },
        },
      },
    });
  }

  return [year, ...quarters];
}

function hints(input: ModuleInput): readonly Hint[] {
  const result = tally(input);
  if (result.totalMs > CONTINGENT_MS) {
    return [
      {
        id: "student.over",
        tone: "attention",
        message: { key: "modules.student.hintOver", values: { year: result.year } },
      },
    ];
  }
  const remaining = CONTINGENT_MS - result.totalMs;
  if (remaining <= LOW_REMAINING_MS) {
    return [
      {
        id: "student.low",
        tone: "attention",
        message: {
          key: "modules.student.hintLow",
          values: { remaining: { durationMs: remaining } },
        },
      },
    ];
  }
  return [];
}

export const student: ModuleDefinition = {
  id: "student",
  label: "modules.student.label",
  description: "modules.student.description",
  summary: "modules.student.summary",
  statutes: ["student"],
  configChoices: [],
  configSchema: z.strictObject({}),
  employeeFields: studentData,
  fields: [
    {
      key: "hours_elsewhere",
      kind: "hours",
      label: "modules.student.fieldHoursElsewhere",
      hint: "modules.student.fieldHoursElsewhereHint",
      required: false,
    },
    {
      key: "checked_on",
      kind: "date",
      label: "modules.student.fieldCheckedOn",
      hint: "modules.student.fieldCheckedOnHint",
      required: false,
    },
  ],
  needsYearToDate: true,
  counters,
  hints,
  exportColumns: [
    { key: "quarter", header: "modules.student.csvQuarter", kind: "text" },
    {
      key: "year_to_date_net_ms",
      header: "modules.student.csvYearToDate",
      kind: "duration",
    },
  ],
  exportValues(input: ExportDayInput) {
    return {
      quarter: `${yearOf(input.day)}-Q${quarterOf(input.day)}`,
      year_to_date_net_ms: input.yearToDateNetMs,
    };
  },
};
