/**
 * Map manage-area RPC failures to friendly Dutch copy keys. Pure so it's
 * unit-testable without a DOM: no `t()` calls here, callers translate the
 * returned key. Mirrors `lib/clock/errors.ts` for the employee app.
 */
import { RpcError } from "@cloxa/db";

export type DecideCorrectionErrorKey =
  | "manageVragen.errorInvalidSequence"
  | "manageVragen.errorSelfDecision"
  | "manageVragen.errorStale"
  | "manageVragen.errorEmployeeInactive"
  | "manageVragen.errorGeneric";

export function mapDecideCorrectionError(error: unknown): DecideCorrectionErrorKey {
  if (error instanceof RpcError) {
    switch (error.message) {
      case "invalid_sequence":
        return "manageVragen.errorInvalidSequence";
      case "self_decision_not_allowed":
        return "manageVragen.errorSelfDecision";
      case "employee_inactive":
        return "manageVragen.errorEmployeeInactive";
      case "not_pending":
      case "target_not_effective":
      case "stale_target":
        return "manageVragen.errorStale";
      default:
        return "manageVragen.errorGeneric";
    }
  }
  return "manageVragen.errorGeneric";
}

/** Keys the decide actions may put in `?error=`: the mapper's, plus the missing-note one. */
export const DECIDE_ERROR_KEYS = [
  "manageVragen.errorInvalidSequence",
  "manageVragen.errorSelfDecision",
  "manageVragen.errorStale",
  "manageVragen.errorEmployeeInactive",
  "manageVragen.errorGeneric",
  "manageVragen.rejectNoteRequired",
] as const;

export type DecideErrorKey = (typeof DECIDE_ERROR_KEYS)[number];

/** A query value as a safe copy key, or null: never trust `?error=` as a catalog key. */
export function decideErrorKey(value: unknown): DecideErrorKey | null {
  return typeof value === "string" &&
    (DECIDE_ERROR_KEYS as readonly string[]).includes(value)
    ? (value as DecideErrorKey)
    : null;
}

export type ManagerCorrectErrorKey =
  | "manageCorrection.errorNotAuthorized"
  | "manageCorrection.errorSelf"
  | "manageCorrection.errorSiteNotAssigned"
  | "manageCorrection.errorInvalid"
  | "manageCorrection.errorAnonymised"
  | "manageCorrection.errorInactive"
  | "manageCorrection.errorSiteInactive"
  | "manageCorrection.errorTargetStale"
  | "manageCorrection.errorTooOld"
  | "manageCorrection.errorInFuture"
  | "manageCorrection.errorNotIncreasing"
  | "manageCorrection.errorConflict"
  | "manageCorrection.errorSequenceClockIn"
  | "manageCorrection.errorSequenceClockOut"
  | "manageCorrection.errorSequenceBreakStart"
  | "manageCorrection.errorSequenceBreakEnd"
  | "manageCorrection.errorSequence"
  | "manageCorrection.errorRateLimited"
  | "manageCorrection.errorGeneric";

/** `invalid_sequence` names the impossible step in its detail: `state=off type=clock_out ...`. */
function sequenceKey(details: string | null): ManagerCorrectErrorKey {
  const type = /(?:^|\s)type=(\w+)/.exec(details ?? "")?.[1];
  switch (type) {
    case "clock_in":
      return "manageCorrection.errorSequenceClockIn";
    case "clock_out":
      return "manageCorrection.errorSequenceClockOut";
    case "break_start":
      return "manageCorrection.errorSequenceBreakStart";
    case "break_end":
      return "manageCorrection.errorSequenceBreakEnd";
    default:
      return "manageCorrection.errorSequence";
  }
}

/** Every refusal of `rpc_manager_correct`, as a copy key (no `t()` here). */
export function mapManagerCorrectError(error: unknown): ManagerCorrectErrorKey {
  if (!(error instanceof RpcError)) return "manageCorrection.errorGeneric";
  switch (error.message) {
    case "not_authorized":
      return "manageCorrection.errorNotAuthorized";
    case "self_correction_not_allowed":
      return "manageCorrection.errorSelf";
    case "site_not_assigned":
      return "manageCorrection.errorSiteNotAssigned";
    case "invalid_kind":
    case "invalid_reason":
    case "invalid_proposal":
    case "invalid_proposed_time":
    case "invalid_targets":
      return "manageCorrection.errorInvalid";
    case "employee_anonymised":
      return "manageCorrection.errorAnonymised";
    case "employee_inactive":
      return "manageCorrection.errorInactive";
    case "site_inactive":
      return "manageCorrection.errorSiteInactive";
    case "target_not_effective":
      return "manageCorrection.errorTargetStale";
    case "target_too_old":
    case "proposed_time_too_old":
      return "manageCorrection.errorTooOld";
    case "proposed_time_in_future":
      return "manageCorrection.errorInFuture";
    case "proposed_times_not_increasing":
      return "manageCorrection.errorNotIncreasing";
    case "proposed_time_conflict":
      return "manageCorrection.errorConflict";
    case "invalid_sequence":
      return sequenceKey(error.details);
    case "correction_rate_limited":
      return "manageCorrection.errorRateLimited";
    default:
      return "manageCorrection.errorGeneric";
  }
}

export type DecideReturnTo = "vandaag" | "aanvragen";

/** The fixed place a decision returns to; anything else means Aanvragen. */
export function decideReturnTo(value: unknown): DecideReturnTo {
  return value === "vandaag" ? "vandaag" : "aanvragen";
}

export type SetScheduleErrorKey =
  | "schedule.errorInvalidValidFrom"
  | "schedule.errorInvalidPattern"
  | "schedule.errorNotAuthorized"
  | "schedule.errorGeneric";

export function mapSetScheduleError(error: unknown): SetScheduleErrorKey {
  if (error instanceof RpcError) {
    switch (error.message) {
      case "invalid_valid_from":
        return "schedule.errorInvalidValidFrom";
      case "invalid_schedule_pattern":
        return "schedule.errorInvalidPattern";
      case "not_authorized":
        return "schedule.errorNotAuthorized";
      default:
        return "schedule.errorGeneric";
    }
  }
  return "schedule.errorGeneric";
}

export type InviteErrorKey =
  | "manageTeam.errorEmailInUse"
  | "manageTeam.errorSiteNotManaged"
  | "manageTeam.errorRoleNotAllowed"
  | "manageTeam.errorEmailDelivery"
  | "manageTeam.errorGeneric";

export function mapInviteError(error: unknown): InviteErrorKey {
  if (error instanceof RpcError) {
    switch (error.message) {
      case "email_already_invited":
      case "email_already_member":
        return "manageTeam.errorEmailInUse";
      case "site_not_managed":
        return "manageTeam.errorSiteNotManaged";
      case "role_not_allowed":
        return "manageTeam.errorRoleNotAllowed";
      default:
        return "manageTeam.errorGeneric";
    }
  }
  return "manageTeam.errorGeneric";
}
