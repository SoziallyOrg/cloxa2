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
  | "manageVragen.errorGeneric";

export function mapDecideCorrectionError(error: unknown): DecideCorrectionErrorKey {
  if (error instanceof RpcError) {
    switch (error.message) {
      case "invalid_sequence":
        return "manageVragen.errorInvalidSequence";
      case "self_decision_not_allowed":
        return "manageVragen.errorSelfDecision";
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
