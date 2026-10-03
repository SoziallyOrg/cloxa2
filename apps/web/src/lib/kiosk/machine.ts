/**
 * The kiosk screen as a pure state machine: idle (name tiles) → pin → action
 * → done → back to idle. Timers live in the component; this only says how
 * long each phase may stay on screen. Never holds hours, only the new state
 * and the server time of the event just recorded.
 */
import type { KioskShiftState } from "@cloxa/db";

import type { KioskErrorView } from "./error-view";

export type KioskClockType = "clock_in" | "clock_out" | "break_start" | "break_end";

export interface KioskPerson {
  readonly id: string;
  readonly name: string;
  readonly hasPin: boolean;
}

export type KioskPhase =
  | { readonly kind: "idle" }
  | {
      readonly kind: "pin";
      readonly person: KioskPerson;
      readonly busy: boolean;
      readonly error: KioskErrorView | null;
    }
  | {
      readonly kind: "action";
      readonly person: KioskPerson;
      /** Kept only until done or timeout: the clock call needs it again. */
      readonly pin: string;
      readonly state: KioskShiftState;
      readonly busy: boolean;
      readonly error: KioskErrorView | null;
    }
  | {
      readonly kind: "done";
      readonly person: KioskPerson;
      readonly clockType: KioskClockType;
      /** Brussels wall time of the recorded event, e.g. `08:02`. */
      readonly time: string;
    };

export type KioskEvent =
  | { readonly type: "select"; readonly person: KioskPerson }
  | { readonly type: "back" }
  | { readonly type: "submitPin" }
  | { readonly type: "statusOk"; readonly pin: string; readonly state: KioskShiftState }
  | { readonly type: "submitAction" }
  | {
      readonly type: "clockOk";
      readonly clockType: KioskClockType;
      readonly time: string;
    }
  | { readonly type: "failed"; readonly error: KioskErrorView }
  | { readonly type: "timeout" };

export const IDLE_PHASE: KioskPhase = { kind: "idle" };

/** The confirmation stays 5 seconds; any other screen 30 seconds without a touch. */
export const DONE_RETURN_MS = 5_000;
export const INACTIVITY_RETURN_MS = 30_000;

export function returnDelayMs(phase: KioskPhase): number | null {
  switch (phase.kind) {
    case "idle":
      return null;
    case "done":
      return DONE_RETURN_MS;
    default:
      return INACTIVITY_RETURN_MS;
  }
}

export function kioskReducer(phase: KioskPhase, event: KioskEvent): KioskPhase {
  switch (event.type) {
    case "timeout":
    case "back":
      return IDLE_PHASE;

    case "select":
      return phase.kind === "idle"
        ? { kind: "pin", person: event.person, busy: false, error: null }
        : phase;

    case "submitPin":
      return phase.kind === "pin" ? { ...phase, busy: true, error: null } : phase;

    case "statusOk":
      return phase.kind === "pin"
        ? {
            kind: "action",
            person: phase.person,
            pin: event.pin,
            state: event.state,
            busy: false,
            error: null,
          }
        : phase;

    case "submitAction":
      return phase.kind === "action" ? { ...phase, busy: true, error: null } : phase;

    case "clockOk":
      return phase.kind === "action"
        ? {
            kind: "done",
            person: phase.person,
            clockType: event.clockType,
            time: event.time,
          }
        : phase;

    case "failed":
      if (event.error.unpaired) return IDLE_PHASE;
      if (phase.kind === "pin") return { ...phase, busy: false, error: event.error };
      if (phase.kind === "action") {
        // A lockout or pause during the action means typing the PIN again.
        return event.error.pinAgain
          ? { kind: "pin", person: phase.person, busy: false, error: event.error }
          : { ...phase, busy: false, error: event.error };
      }
      return phase;
  }
}

/** `Jan Janssens` → `Jan`, for the confirmation. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
