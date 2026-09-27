/**
 * Pure derivation of a shift's current state from an ordered list of clock
 * events. No I/O, no wall-clock reads: callers supply the event log.
 */

export type ClockEventType = "clock_in" | "clock_out" | "break_start" | "break_end";

export interface ClockEvent {
  readonly type: ClockEventType;
}

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
 * Fold an ordered event log into a shift state, rejecting any sequence that
 * contains an out-of-order transition (e.g. `break_end` while `off`).
 */
export function deriveShiftState(
  events: readonly ClockEvent[],
): DeriveShiftStateResult {
  let state: ShiftState = "off";

  for (const [index, event] of events.entries()) {
    const nextState: ShiftState | undefined = TRANSITIONS[state][event.type];

    if (nextState === undefined) {
      return {
        ok: false,
        error: `Invalid transition: "${event.type}" is not allowed while shift state is "${state}".`,
        index,
      };
    }

    state = nextState;
  }

  return { ok: true, state };
}
