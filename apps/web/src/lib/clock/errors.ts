/**
 * Map RPC failures to friendly Dutch copy. Pure so it's unit-testable
 * without a DOM: no `t()` calls here — callers translate the returned key.
 */
import { RpcError } from "@cloxa/db";

export type ClockErrorKey =
  | "clockErrors.invalidTransition"
  | "clockErrors.notAssigned"
  | "clockErrors.network"
  | "clockErrors.generic";

/**
 * `error` is `unknown` because it crosses a server action boundary (caught
 * in a try/catch); a network failure surfaces as a plain `TypeError` there,
 * never an `RpcError`.
 */
export function mapClockError(error: unknown): ClockErrorKey {
  if (error instanceof RpcError) {
    if (error.message === "invalid_transition") return "clockErrors.invalidTransition";
    if (error.message === "site_not_assigned") return "clockErrors.notAssigned";
    return "clockErrors.generic";
  }
  if (isNetworkError(error)) return "clockErrors.network";
  return "clockErrors.generic";
}

function isNetworkError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = "name" in error ? String((error as { name: unknown }).name) : "";
  const message =
    "message" in error ? String((error as { message: unknown }).message) : "";
  return (
    name === "TypeError" &&
    (/fetch/i.test(message) || /network/i.test(message) || message === "")
  );
}

export type CorrectionErrorKey =
  | "correctionForm.tooOld"
  | "correctionForm.inFuture"
  | "correctionForm.invalidSequence"
  | "correctionForm.tooManyPending"
  | "correctionForm.validationError"
  | "correctionForm.genericError";

export function mapCorrectionError(error: unknown): CorrectionErrorKey {
  if (error instanceof RpcError) {
    switch (error.message) {
      case "target_too_old":
      case "proposed_time_too_old":
        return "correctionForm.tooOld";
      case "proposed_time_in_future":
        return "correctionForm.inFuture";
      case "invalid_sequence":
        return "correctionForm.invalidSequence";
      case "too_many_pending":
        return "correctionForm.tooManyPending";
      case "invalid_proposal":
      case "invalid_proposed_time":
      case "invalid_targets":
      case "invalid_reason":
      case "invalid_kind":
      case "target_not_effective":
        return "correctionForm.validationError";
      default:
        return "correctionForm.genericError";
    }
  }
  return "correctionForm.genericError";
}
