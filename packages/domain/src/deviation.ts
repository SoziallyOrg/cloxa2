/**
 * Factual comparison of worked time against a planned schedule for one day.
 * No judgement: field names describe what was measured, not whether it was
 * acceptable.
 */

import type { Shift } from "./shifts";

export interface PlannedBlock {
  readonly start: number;
  readonly end: number;
}

export interface DeviationFromSchedule {
  readonly plannedMs: number;
  readonly workedNetMs: number;
  /** workedNetMs - plannedMs. */
  readonly deltaMs: number;
  /** How much later than the earliest planned block the first shift started, 0 if not later or no data. */
  readonly lateStartMs: number;
  /** How much earlier than the latest planned block the last shift ended, 0 if not earlier, still open, or no data. */
  readonly earlyEndMs: number;
}

export function deviationFromSchedule(
  shifts: readonly Shift[],
  plannedBlocks: readonly PlannedBlock[],
): DeviationFromSchedule {
  const plannedMs = plannedBlocks.reduce(
    (sum, block) => sum + (block.end - block.start),
    0,
  );
  const workedNetMs = shifts.reduce((sum, shift) => sum + shift.netMs, 0);

  const plannedStart = earliest(plannedBlocks.map((block) => block.start));
  const plannedEnd = latest(plannedBlocks.map((block) => block.end));
  const actualStart = earliest(shifts.map((shift) => shift.start));

  const lastShift = shifts.at(-1);
  const actualEnd = lastShift !== undefined && !lastShift.open ? lastShift.end : null;

  const lateStartMs =
    plannedStart !== null && actualStart !== null
      ? Math.max(0, actualStart - plannedStart)
      : 0;

  const earlyEndMs =
    plannedEnd !== null && actualEnd !== null ? Math.max(0, plannedEnd - actualEnd) : 0;

  return {
    plannedMs,
    workedNetMs,
    deltaMs: workedNetMs - plannedMs,
    lateStartMs,
    earlyEndMs,
  };
}

function earliest(values: readonly number[]): number | null {
  return values.length === 0 ? null : Math.min(...values);
}

function latest(values: readonly number[]): number | null {
  return values.length === 0 ? null : Math.max(...values);
}
