/**
 * Pattern (`@cloxa/db`'s `SchedulePattern`, the RPC/DB shape) <-> form state
 * conversion. Pure so it's unit-testable without a DOM.
 */
import type { SchedulePattern } from "@cloxa/db";

import {
  EMPTY_SCHEDULE_FORM_STATE,
  SCHEDULE_DAY_KEYS,
  type ScheduleDayKey,
  type ScheduleFormBlock,
  type ScheduleFormState,
} from "./types";

/**
 * The DB allows `"24:00"` as a block's `end` (a block that ends exactly at
 * midnight without continuing into the next day). `<input type="time">`
 * can't represent that, so the editor shows it as `"00:00"` — the same
 * instant the server computes for an overnight block anyway. Round-tripping
 * this through the editor and saving again turns it into a genuine
 * "continues past midnight" block instead, which is a harmless, equivalent
 * change (see `private.schedule_for` in the schedules migration).
 */
function blockToFormBlock(block: { start: string; end: string }): ScheduleFormBlock {
  return { start: block.start, end: block.end === "24:00" ? "00:00" : block.end };
}

/** Builds the editor's initial state from a stored pattern (or none yet). */
export function patternToFormState(
  pattern: SchedulePattern | null | undefined,
): ScheduleFormState {
  if (!pattern) return EMPTY_SCHEDULE_FORM_STATE;
  const state: Record<ScheduleDayKey, ScheduleFormBlock[]> = {
    mon: [],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [],
  };
  for (const day of SCHEDULE_DAY_KEYS) {
    const blocks = pattern[day];
    if (blocks) state[day] = blocks.map(blockToFormBlock);
  }
  return state;
}

/**
 * Builds the RPC input from the editor's state. Days without blocks are
 * omitted (an empty array is valid too, but omitting keeps the stored
 * pattern minimal). Exceptions aren't edited here, so the result never has
 * any.
 */
export function formStateToPattern(form: ScheduleFormState): SchedulePattern {
  const pattern: Record<string, ScheduleFormBlock[]> = {};
  for (const day of SCHEDULE_DAY_KEYS) {
    const blocks = form[day];
    if (blocks.length > 0) pattern[day] = blocks.map((block) => ({ ...block }));
  }
  return pattern as SchedulePattern;
}
