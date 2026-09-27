/**
 * Pure derivation of a shift's current state from an ordered list of
 * effective clock events. No I/O, no wall-clock reads: callers supply the
 * event log, already filtered by `effectiveEvents` and sorted.
 */

import type { ClockEvent, ClockEventType } from "./clock-event";

export type ShiftState = "off" | "working" | "on_break";

export interface DeriveShiftStateSuccess {
  readonly ok: true;
  readonly state: ShiftState;
}

export interface DeriveShiftStateFailure {
  readonly ok: false;
  readonly error: string;
  /** Index of the first event that produced an invalid transition. */
  readonly index: number;
}

export type DeriveShiftStateResult = DeriveShiftStateSuccess | DeriveShiftStateFailure;

const TRANSITIONS: Record<ShiftState, Partial<Record<ClockEventType, ShiftState>>> = {
  off: { clock_in: "working" },
  working: { break_start: "on_break", clock_out: "off" },
  on_break: { break_end: "working" },
};

/**
 * Look up the next shift state for an event type, or `undefined` if that
 * event is not valid while in `state`. Shared by `deriveShiftState` and
 * `validateSequence` so the transition table has one home.
 */
export function nextShiftState(
  state: ShiftState,
  type: ClockEventType,
): ShiftState | undefined {
  return TRANSITIONS[state][type];
}

/**
 * Fold an ordered, effective event log into a shift state, rejecting any
 * sequence that contains an out-of-order transition (e.g. `break_end` while
 * `off`).
 */
export function deriveShiftState(
  events: readonly Pick<ClockEvent, "type">[],
): DeriveShiftStateResult {
  let state: ShiftState = "off";

  for (const [index, event] of events.entries()) {
    const next = nextShiftState(state, event.type);

    if (next === undefined) {
      return {
        ok: false,
        error: `Invalid transition: "${event.type}" is not allowed while shift state is "${state}".`,
        index,
      };
    }

    state = next;
  }

  return { ok: true, state };
}
