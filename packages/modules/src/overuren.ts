/**
 * Voluntary overtime (legal-notes §1.4): 360 hours per year (horeca 450), of
 * which 240 (horeca 360) carry no premium. We found no registration format,
 * so this is a plain tally: per calendar year, the time worked above the
 * planned schedule on days that have a schedule. Indicative; the employer
 * decides what counts as voluntary overtime.
 */
import { z } from "zod";

import { HOUR_MS, plannedByDay, plannedMs, workedByDay, yearOf } from "./calendar";
import type {
  Counter,
  ExportDayInput,
  Hint,
  ModuleDefinition,
  ModuleInput,
} from "./types";

export const overurenConfig = z.strictObject({
  sector: z.enum(["general", "horeca"]).optional(),
});
export type OverurenConfig = z.output<typeof overurenConfig>;

/** [first threshold, ceiling] in hours. */
export function overurenThresholds(config: unknown): readonly [number, number] {
  const parsed = overurenConfig.safeParse(config);
  const sector = parsed.success ? (parsed.data.sector ?? "general") : "general";
  return sector === "horeca" ? [360, 450] : [240, 360];
}

/** Worked above planned on one day; null on a day without a plan. */
function aboveOnDay(workedMs: number, planned: number): number | null {
  if (planned <= 0) return null;
  return Math.max(0, workedMs - planned);
}

function yearAboveMs(input: ModuleInput): { year: number; aboveMs: number } {
  const year = yearOf(input.period.to);
  const worked = workedByDay(input.shifts, input.period.now, input.period.to);
  let aboveMs = 0;
  for (const [day, blocks] of plannedByDay(input.planned)) {
    if (yearOf(day) !== year || day > input.period.to) continue;
    aboveMs += aboveOnDay(worked.get(day) ?? 0, plannedMs(blocks)) ?? 0;
  }
  return { year, aboveMs };
}

function counters(input: ModuleInput): readonly Counter[] {
  const { year, aboveMs } = yearAboveMs(input);
  const [first, ceiling] = overurenThresholds(input.config);
  return [
    {
      id: "overuren.year",
      display: "figure",
      label: { key: "modules.overuren.yearLabel", values: { year } },
      value: { key: "modules.value", values: { value: { durationMs: aboveMs } } },
      progress: {
        value: aboveMs,
        max: ceiling * HOUR_MS,
        label: { key: "modules.overuren.progressLabel", values: { ceiling } },
        start: { key: "modules.overuren.progressStart" },
        end: { key: "modules.overuren.progressEnd", values: { ceiling } },
      },
      lines: [
        { key: "modules.overuren.thresholds", values: { first, second: ceiling } },
        { key: "modules.overuren.plannedDaysOnly" },
      ],
    },
  ];
}

function hints(input: ModuleInput): readonly Hint[] {
  const { year, aboveMs } = yearAboveMs(input);
  const [first, ceiling] = overurenThresholds(input.config);
  if (aboveMs > ceiling * HOUR_MS) {
    return [
      {
        id: "overuren.ceiling",
        tone: "attention",
        message: {
          key: "modules.overuren.hintAbove",
          values: { hours: ceiling, year },
        },
      },
    ];
  }
  if (aboveMs > first * HOUR_MS) {
    return [
      {
        id: "overuren.first",
        tone: "info",
        message: { key: "modules.overuren.hintAbove", values: { hours: first, year } },
      },
    ];
  }
  return [];
}

export const overuren: ModuleDefinition = {
  id: "overuren",
  label: "modules.overuren.label",
  description: "modules.overuren.description",
  statutes: ["bediende", "arbeider", "other"],
  configChoices: [
    {
      key: "sector",
      label: "modules.overuren.sectorLabel",
      footer: "modules.overuren.sectorFooter",
      options: [
        {
          value: "general",
          label: "modules.overuren.sectorGeneral",
          detail: "modules.overuren.sectorGeneralValue",
        },
        {
          value: "horeca",
          label: "modules.overuren.sectorHoreca",
          detail: "modules.overuren.sectorHorecaValue",
        },
      ],
    },
  ],
  configSchema: overurenConfig,
  employeeFields: null,
  fields: [],
  needsYearToDate: false,
  counters,
  hints,
  exportColumns: [
    {
      key: "above_planned_ms",
      header: "modules.overuren.csvAbovePlanned",
      kind: "duration",
    },
  ],
  exportValues(input: ExportDayInput) {
    const worked = input.shifts.reduce((sum, shift) => sum + shift.netMs, 0);
    return { above_planned_ms: aboveOnDay(worked, plannedMs(input.planned)) };
  },
};
