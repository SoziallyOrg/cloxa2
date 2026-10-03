/**
 * Validation mirroring `private.is_valid_schedule_blocks` (see the schedules
 * migration's comment for the shape): sorted, non-overlapping HH:MM blocks,
 * only the last of which may cross midnight (end < start), no zero-length
 * block. Runs client- and server-side before the RPC call, so the editor can
 * show an error next to the day instead of waiting for the database to
 * refuse it. Pure so it's unit-testable without a DOM; callers translate the
 * returned error codes (`schedule.error*` in the catalog).
 */
import { MAX_BLOCKS_PER_DAY, SCHEDULE_DAY_KEYS, type ScheduleFormState } from "./types";

export type ScheduleBlockErrorCode =
  "tooManyBlocks" | "invalidTime" | "zeroLength" | "overlap" | "afterOvernight";

const START_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const END_PATTERN = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

function toMinutes(value: string, allow24: boolean): number | null {
  if (allow24 && value === "24:00") return 1440;
  if (!START_PATTERN.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/** Validates one day's blocks. Returns `null` when they're all valid. */
export function validateDayBlocks(
  blocks: readonly { start: string; end: string }[],
): ScheduleBlockErrorCode | null {
  if (blocks.length > MAX_BLOCKS_PER_DAY) return "tooManyBlocks";

  let previousEnd = -1;
  let crossed = false;
  for (const block of blocks) {
    if (!START_PATTERN.test(block.start) || !END_PATTERN.test(block.end)) {
      return "invalidTime";
    }
    const start = toMinutes(block.start, false);
    const end = toMinutes(block.end, true);
    if (start === null || end === null) return "invalidTime";
    if (crossed) return "afterOvernight";
    if (start === end) return "zeroLength";
    if (start < previousEnd) return "overlap";
    crossed = end < start;
    previousEnd = end;
  }
  return null;
}

export type ScheduleFormErrors = Partial<
  Record<(typeof SCHEDULE_DAY_KEYS)[number], ScheduleBlockErrorCode>
>;

/** Validates every day. An empty result means the whole form is valid. */
export function validateScheduleForm(form: ScheduleFormState): ScheduleFormErrors {
  const errors: ScheduleFormErrors = {};
  for (const day of SCHEDULE_DAY_KEYS) {
    const error = validateDayBlocks(form[day]);
    if (error) errors[day] = error;
  }
  return errors;
}
