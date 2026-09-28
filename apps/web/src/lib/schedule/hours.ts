/**
 * Weekly hours total for the "indicatief" summary shown before saving. Pure
 * so it's unit-testable without a DOM.
 */
import { formatDurationMs } from "../../components/clock/format";
import { SCHEDULE_DAY_KEYS, type ScheduleFormState } from "./types";

function toMinutes(value: string): number {
  if (value === "24:00") return 1440;
  const [hours, minutes] = value.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/** A block's length in minutes; an overnight block (end < start) wraps past midnight. */
function blockMinutes(block: { start: string; end: string }): number {
  const start = toMinutes(block.start);
  const end = toMinutes(block.end);
  return (end < start ? end + 1440 : end) - start;
}

/** Total planned minutes across all 7 days, including overnight blocks. */
export function weeklyMinutes(form: ScheduleFormState): number {
  let total = 0;
  for (const day of SCHEDULE_DAY_KEYS) {
    for (const block of form[day]) total += blockMinutes(block);
  }
  return total;
}

/** Same "37 u 30 min" style as every other duration in the app. */
export function formatWeeklyHours(totalMinutes: number): string {
  return formatDurationMs(totalMinutes * 60_000);
}
