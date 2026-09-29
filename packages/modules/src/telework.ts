/**
 * Telework (legal-notes §1.10): no specific registration obligation today.
 * When the organization enables it, the employee says at "Start werk"
 * whether this shift is at the workplace or at home. Nothing is tracked:
 * one word per shift, counted per month.
 */
import { z } from "zod";

import { monthOf, shiftDay } from "./calendar";
import type { Counter, ExportDayInput, ModuleDefinition, ModuleInput } from "./types";

const MAX_MONTHS = 3;

function previousMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  return index === 1
    ? `${year - 1}-12`
    : `${year}-${String(index - 1).padStart(2, "0")}`;
}

function counters(input: ModuleInput): readonly Counter[] {
  const counts = new Map<string, { home: number; site: number }>();
  for (const shift of input.shifts) {
    if (shift.workLocation === undefined) continue;
    const day = shiftDay(shift);
    if (day < input.period.from || day > input.period.to) continue;
    const month = monthOf(day);
    const entry = counts.get(month) ?? { home: 0, site: 0 };
    entry[shift.workLocation] += 1;
    counts.set(month, entry);
  }

  // This month always, then earlier months of the period that have shifts.
  const first = monthOf(input.period.from);
  const result: Counter[] = [];
  for (
    let month = monthOf(input.period.to);
    month >= first && result.length < MAX_MONTHS;
    month = previousMonth(month)
  ) {
    const entry = counts.get(month);
    if (entry === undefined && result.length > 0) continue;
    result.push({
      id: `telework.${month}`,
      display: "row",
      label: { key: "modules.telework.monthLabel", values: { month: { month } } },
      value: {
        key: "modules.telework.monthValue",
        values: { home: entry?.home ?? 0, site: entry?.site ?? 0 },
      },
    });
  }
  return result;
}

export const telework: ModuleDefinition = {
  id: "telework",
  label: "modules.telework.label",
  description: "modules.telework.description",
  statutes: "all",
  configChoices: [],
  configSchema: z.strictObject({}),
  employeeFields: null,
  fields: [],
  needsYearToDate: false,
  counters,
  hints: () => [],
  exportColumns: [
    { key: "home_shifts", header: "modules.telework.csvHome", kind: "count" },
    { key: "site_shifts", header: "modules.telework.csvSite", kind: "count" },
  ],
  exportValues(input: ExportDayInput) {
    return {
      home_shifts: input.shifts.filter((shift) => shift.workLocation === "home").length,
      site_shifts: input.shifts.filter((shift) => shift.workLocation === "site").length,
    };
  },
};
