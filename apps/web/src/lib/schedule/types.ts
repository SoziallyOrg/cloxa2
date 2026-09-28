/**
 * Shared shapes for the weekly schedule editor. `ScheduleFormState` is the
 * UI's in-memory representation: always all 7 days present, blocks always
 * arrays (possibly empty), so the editor never has to guard for missing
 * keys. `@cloxa/db`'s `SchedulePattern` (the RPC input/DB shape) only has
 * keys for days that carry blocks, so it's slightly more compact.
 */

export type ScheduleDayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/** Monday first, matching the editor's row order and Belgian convention. */
export const SCHEDULE_DAY_KEYS: readonly ScheduleDayKey[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

/** Ma-vr: used by "kopieer maandag naar alle werkdagen" and the templates. */
export const SCHEDULE_WORKDAY_KEYS: readonly ScheduleDayKey[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
];

/** At most 3 blocks per day in the editor (the DB itself allows up to 6). */
export const MAX_BLOCKS_PER_DAY = 3;

export interface ScheduleFormBlock {
  readonly start: string;
  readonly end: string;
}

export type ScheduleFormState = Readonly<
  Record<ScheduleDayKey, readonly ScheduleFormBlock[]>
>;

export const EMPTY_SCHEDULE_FORM_STATE: ScheduleFormState = {
  mon: [],
  tue: [],
  wed: [],
  thu: [],
  fri: [],
  sat: [],
  sun: [],
};
