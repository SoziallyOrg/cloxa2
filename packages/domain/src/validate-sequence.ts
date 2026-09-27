import type { ClockEvent } from "./clock-event";
import { nextShiftState, type ShiftState } from "./shift-state";

export interface SequenceProblem {
  readonly index: number;
  readonly reason: string;
}

/**
 * Walk an ordered, effective event log and collect every invalid
 * transition, instead of stopping at the first one. Used to validate a
 * whole day at once, e.g. when a correction approval re-validates every
 * event on the affected day.
 *
 * An event that would be invalid is skipped (the state is left unchanged)
 * so later, valid events are still checked against the state they would
 * actually follow.
 */
export function validateSequence(events: readonly ClockEvent[]): SequenceProblem[] {
  const problems: SequenceProblem[] = [];
  let state: ShiftState = "off";

  for (const [index, event] of events.entries()) {
    const next = nextShiftState(state, event.type);

    if (next === undefined) {
      problems.push({
        index,
        reason: `Invalid transition: "${event.type}" is not allowed while shift state is "${state}".`,
      });
      continue;
    }

    state = next;
  }

  return problems;
}
