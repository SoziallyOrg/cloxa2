/**
 * Pure step state and payload building for the 3-step guided correction
 * form. No I/O: `buildCorrectionPayload` returns the same shape
 * `requestCorrection` (`@cloxa/db`) expects, ready to `.parse()`.
 */
import { brusselsDayKey } from "@cloxa/domain";
import { brusselsLocalToInstant, t } from "@cloxa/i18n";
import type { RequestCorrectionInput } from "@cloxa/db";

export type CorrectionKind = "add" | "adjust" | "remove";
export type CorrectionEventType =
  "clock_in" | "clock_out" | "break_start" | "break_end";

export interface CorrectionTargetOption {
  readonly id: string;
  readonly type: CorrectionEventType;
  /** ISO instant, for display and as the base date/time when adjusting. */
  readonly occurredAtIso: string;
  /** "za 3 okt": set when the moment falls on another day than the shift's day (night shift). */
  readonly dayLabel?: string;
}

export interface CorrectionFormState {
  readonly step: 1 | 2 | 3;
  readonly kind: CorrectionKind | null;
  /** `add` only: which kind of moment was missed. */
  readonly eventType: CorrectionEventType | null;
  /** `add`/`adjust`: local Brussels date, `YYYY-MM-DD`. */
  readonly date: string;
  /** `add`/`adjust`: local Brussels time, `HH:mm`. */
  readonly time: string;
  /** `adjust`/`remove`: the effective event being changed. */
  readonly targetEventId: string | null;
  readonly reason: string;
}

export const INITIAL_CORRECTION_FORM_STATE: CorrectionFormState = {
  step: 1,
  kind: null,
  eventType: null,
  date: "",
  time: "",
  targetEventId: null,
  reason: "",
};

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Whether the current step is filled in well enough to move on. */
export function canAdvance(
  state: CorrectionFormState,
  targets: readonly CorrectionTargetOption[],
  options: CorrectionFormOptions = {},
): boolean {
  if (state.step === 1) return state.kind !== null;

  if (state.step === 2) {
    if (state.kind === "add") {
      return (
        state.eventType !== null &&
        DATE_PATTERN.test(state.date) &&
        TIME_PATTERN.test(state.time)
      );
    }
    if (state.kind === "adjust") {
      return (
        state.targetEventId !== null &&
        DATE_PATTERN.test(state.date) &&
        TIME_PATTERN.test(state.time)
      );
    }
    if (state.kind === "remove") {
      return state.targetEventId !== null && targets.length > 0;
    }
    return false;
  }

  // Step 3: the reason is optional for an employee, required for a manager.
  return !options.reasonRequired || state.reason.trim() !== "";
}

export interface CorrectionFormOptions {
  /** A manager's correction always carries a reason (the employee reads it). */
  readonly reasonRequired?: boolean;
}

/** "Gestopt met werken om 05:12 (za 3 okt)": the day only when it is another one. */
export function describeMoment(
  typeLabel: string,
  time: string,
  dayLabel?: string,
): string {
  return dayLabel
    ? t("correctionForm.targetOptionOtherDay", { type: typeLabel, time, day: dayLabel })
    : t("correctionForm.targetOption", { type: typeLabel, time });
}

export function goNext(
  state: CorrectionFormState,
  targets: readonly CorrectionTargetOption[],
  options: CorrectionFormOptions = {},
): CorrectionFormState {
  if (!canAdvance(state, targets, options) || state.step === 3) return state;
  return { ...state, step: (state.step + 1) as CorrectionFormState["step"] };
}

export function goBack(state: CorrectionFormState): CorrectionFormState {
  if (state.step === 1) return state;
  return { ...state, step: (state.step - 1) as CorrectionFormState["step"] };
}

/**
 * The zod input `requestCorrection` (`@cloxa/db`) expects, or `null` when
 * the form isn't complete enough yet (callers should already have gated
 * this with `canAdvance` on every step, so this is a defensive fallback).
 */
export function buildCorrectionPayload(
  state: CorrectionFormState,
  siteId: string,
  options: CorrectionFormOptions = {},
  targets: readonly CorrectionTargetOption[] = [],
): RequestCorrectionInput | null {
  // The RPC requires a non-empty reason; an employee may leave it empty (a
  // default is sent), a manager may not.
  const typed = state.reason.trim();
  if (options.reasonRequired && typed === "") return null;
  const reason = typed || t("correctionForm.defaultReason");

  if (state.kind === "add") {
    if (
      state.eventType === null ||
      !DATE_PATTERN.test(state.date) ||
      !TIME_PATTERN.test(state.time)
    ) {
      return null;
    }
    return {
      kind: "add",
      events: [
        {
          type: state.eventType,
          occurredAt: brusselsLocalToInstant(state.date, state.time).toISOString(),
          siteId,
        },
      ],
      reason,
    };
  }

  if (state.kind === "adjust") {
    if (
      state.targetEventId === null ||
      !DATE_PATTERN.test(state.date) ||
      !TIME_PATTERN.test(state.time)
    ) {
      return null;
    }
    // The new time stays on the moment's own day: the clock-out of a night
    // shift sits on the day after `state.date` (the shift's day).
    const target = targets.find((candidate) => candidate.id === state.targetEventId);
    const date = target
      ? brusselsDayKey(new Date(target.occurredAtIso).getTime())
      : state.date;
    return {
      kind: "adjust",
      events: [
        {
          targetEventId: state.targetEventId,
          occurredAt: brusselsLocalToInstant(date, state.time).toISOString(),
        },
      ],
      reason,
    };
  }

  if (state.kind === "remove") {
    if (state.targetEventId === null) return null;
    return { kind: "remove", targetEventIds: [state.targetEventId], reason };
  }

  return null;
}
