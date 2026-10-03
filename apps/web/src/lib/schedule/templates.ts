/**
 * Quick-start templates and "copy Monday" for the schedule editor. Pure so
 * they're unit-testable without a DOM.
 */
import {
  EMPTY_SCHEDULE_FORM_STATE,
  SCHEDULE_WORKDAY_KEYS,
  type ScheduleFormState,
} from "./types";

/** Ma-vr 08:00-12:00 + 12:30-16:30 (30 min pauze), weekend leeg. */
export function fullTimeTemplate(): ScheduleFormState {
  const blocks = [
    { start: "08:00", end: "12:00" },
    { start: "12:30", end: "16:30" },
  ];
  return {
    ...EMPTY_SCHEDULE_FORM_STATE,
    mon: blocks,
    tue: blocks,
    wed: blocks,
    thu: blocks,
    fri: blocks,
  };
}

/** Ma-vr 08:00-12:00, weekend leeg. */
export function partTimeMorningTemplate(): ScheduleFormState {
  const blocks = [{ start: "08:00", end: "12:00" }];
  return {
    ...EMPTY_SCHEDULE_FORM_STATE,
    mon: blocks,
    tue: blocks,
    wed: blocks,
    thu: blocks,
    fri: blocks,
  };
}

/** No blocks on any day. */
export function emptyTemplate(): ScheduleFormState {
  return EMPTY_SCHEDULE_FORM_STATE;
}

/** Copies Monday's blocks onto every other weekday (ma-vr); weekend untouched. */
export function copyMondayToWorkdays(form: ScheduleFormState): ScheduleFormState {
  const next: Record<string, readonly { start: string; end: string }[]> = { ...form };
  for (const day of SCHEDULE_WORKDAY_KEYS) {
    next[day] = form.mon.map((block) => ({ ...block }));
  }
  return next as ScheduleFormState;
}
