/**
 * Module columns for the signed export: one `modules` object per
 * employee-day, keyed by module id, holding that module's export columns.
 * Only enabled modules that apply to the employee's statute are present.
 */
import type { Shift } from "@cloxa/domain";

import { shiftDay, yearOf } from "./calendar";
import { appliesTo, type EnabledModule } from "./registry";
import type { ExportDayInput, ExportValue, ModuleId } from "./types";

export type ExportModules = Partial<Record<ModuleId, Record<string, ExportValue>>>;

/**
 * Net time of shifts that started from 1 January of `day`'s year up to and
 * including `day`. `shifts` must hold that whole range.
 */
export function yearToDateNetMs(shifts: readonly Shift[], day: string): number {
  const first = `${yearOf(day)}-01-01`;
  let total = 0;
  for (const shift of shifts) {
    const start = shiftDay(shift);
    if (start >= first && start <= day) total += shift.netMs;
  }
  return total;
}

export function exportModules(
  enabled: readonly EnabledModule[],
  statute: string,
  day: Omit<ExportDayInput, "config" | "data" | "yearToDateNetMs">,
  dataFor: (id: ModuleId) => unknown,
  yearShifts: readonly Shift[],
): ExportModules {
  const result: ExportModules = {};
  for (const { module, config } of enabled) {
    if (!appliesTo(module, statute)) continue;
    result[module.id] = {
      ...module.exportValues({
        ...day,
        config,
        data: dataFor(module.id),
        yearToDateNetMs: module.needsYearToDate
          ? yearToDateNetMs(yearShifts, day.day)
          : null,
      }),
    };
  }
  return result;
}
