/**
 * Server-side kiosk failures as copy keys. Pure (no `t()`), so it is testable
 * without a DOM; callers translate. The screen-side view lives in
 * `./error-view` (no `@cloxa/db` there, it ships to the tablet).
 */
import { RpcError } from "@cloxa/db";
import type { CatalogKey } from "@cloxa/i18n";

import { pinProblemKey } from "./pin";

export { kioskErrorView, SHOW_TRIES_LEFT_AT, type KioskErrorView } from "./error-view";

/** A thrown failure (roster, or the network) as a kiosk code. */
export function kioskFailureCode(error: unknown): string {
  if (error instanceof RpcError) {
    if (error.message === "device_unknown" || error.message === "device_paused") {
      return error.message;
    }
    return "generic";
  }
  if (error instanceof TypeError) return "network";
  return "generic";
}

export function pairErrorKey(code: string): CatalogKey {
  switch (code) {
    case "code_invalid":
      return "kiosk.pairErrorCode";
    case "pairing_paused":
      return "kiosk.pairErrorPaused";
    default:
      return "kiosk.pairErrorGeneric";
  }
}

/** PIN settings (own or a manager's), from the form check or the database. */
export function pinErrorKey(error: unknown): CatalogKey {
  const code =
    typeof error === "string" ? error : error instanceof RpcError ? error.message : "";
  return pinProblemKey(code);
}

export function manageKioskErrorKey(error: unknown): CatalogKey {
  if (!(error instanceof RpcError)) return "manageKiosks.errorGeneric";
  switch (error.message) {
    case "invalid_name":
      return "manageKiosks.errorName";
    case "site_inactive":
      return "manageKiosks.errorSite";
    case "not_authorized":
      return "manageKiosks.errorNotAllowed";
    case "device_revoked":
      return "manageKiosks.errorRevoked";
    default:
      return "manageKiosks.errorGeneric";
  }
}
