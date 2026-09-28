/**
 * Pure decisions for privileged sessions (ADR 002). The database enforces the
 * same 12-hour MFA limit through `private.has_fresh_mfa()`; the idle timeout
 * exists only here, because the database cannot see idleness.
 */

/** Absolute limit since the last second-factor verification. */
export const MFA_MAX_AGE_SECONDS = 12 * 3600;
/** Idle timeout for `/manage`. */
export const IDLE_TIMEOUT_SECONDS = 30 * 60;
/** Tolerated clock skew between us and the auth server, as in the database. */
export const CLOCK_SKEW_SECONDS = 300;

const SECOND_FACTORS = new Set(["totp", "webauthn"]);

/** Epoch seconds of the newest totp/webauthn entry in the JWT `amr`, or null. */
export function latestSecondFactorAt(amr: unknown): number | null {
  if (!Array.isArray(amr)) return null;

  let latest: number | null = null;
  for (const entry of amr as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
    if (typeof method !== "string" || !SECOND_FACTORS.has(method)) continue;
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) continue;
    if (latest === null || timestamp > latest) latest = timestamp;
  }
  return latest;
}

/** Within `maxAge` seconds before `now`, or at most the clock skew ahead of it. */
function isWithin(at: number | null, now: number, maxAge: number): boolean {
  return at !== null && at >= now - maxAge && at <= now + CLOCK_SKEW_SECONDS;
}

export function isMfaFresh(amr: unknown, nowSeconds: number): boolean {
  return isWithin(latestSecondFactorAt(amr), nowSeconds, MFA_MAX_AGE_SECONDS);
}

export function isActivityFresh(
  lastActivitySeconds: number | null,
  nowSeconds: number,
): boolean {
  return isWithin(lastActivitySeconds, nowSeconds, IDLE_TIMEOUT_SECONDS);
}

export type ManageGate =
  | { kind: "ok" }
  /** No verified factor yet: set up TOTP first. */
  | { kind: "enroll" }
  /** A factor exists but this session needs (re)verification. */
  | { kind: "verify"; reason: "aal" | "mfa_expired" | "idle" };

export interface ManageGateInput {
  aal: unknown;
  amr: unknown;
  hasVerifiedFactor: boolean;
  /** Epoch seconds from the signed activity cookie, or null when missing or invalid. */
  lastActivityAt: number | null;
  nowSeconds: number;
}

/** Fails closed: anything missing or malformed means "verify again". */
export function decideManageAccess({
  aal,
  amr,
  hasVerifiedFactor,
  lastActivityAt,
  nowSeconds,
}: ManageGateInput): ManageGate {
  if (aal !== "aal2") {
    return hasVerifiedFactor ? { kind: "verify", reason: "aal" } : { kind: "enroll" };
  }
  if (!isMfaFresh(amr, nowSeconds)) return { kind: "verify", reason: "mfa_expired" };
  if (!isActivityFresh(lastActivityAt, nowSeconds))
    return { kind: "verify", reason: "idle" };
  return { kind: "ok" };
}
