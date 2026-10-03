/**
 * Signing out with actions still queued: they stay on this device (keyed by
 * employee) until the same person signs in again, so warn first and let
 * them confirm. Pure, so the decision is testable without a DOM.
 */
export type SignOutDecision = "sign_out" | "warn";

export function signOutDecision(
  pendingCount: number,
  confirmed: boolean,
): SignOutDecision {
  return pendingCount > 0 && !confirmed ? "warn" : "sign_out";
}
