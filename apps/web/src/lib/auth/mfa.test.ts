import { describe, expect, it } from "vitest";

import {
  decideManageAccess,
  IDLE_TIMEOUT_SECONDS,
  isActivityFresh,
  isMfaFresh,
  latestSecondFactorAt,
  MFA_MAX_AGE_SECONDS,
} from "./mfa";

const NOW = 1_790_000_000;

describe("latestSecondFactorAt", () => {
  it("takes the newest totp or webauthn entry", () => {
    expect(
      latestSecondFactorAt([
        { method: "otp", timestamp: NOW },
        { method: "totp", timestamp: NOW - 100 },
        { method: "webauthn", timestamp: NOW - 50 },
      ]),
    ).toBe(NOW - 50);
  });

  it("ignores first factors, string amr and malformed entries", () => {
    expect(latestSecondFactorAt([{ method: "otp", timestamp: NOW }])).toBeNull();
    expect(latestSecondFactorAt(["totp"])).toBeNull();
    expect(latestSecondFactorAt([{ method: "totp", timestamp: "123" }])).toBeNull();
    expect(latestSecondFactorAt([null, 1, { method: "totp" }])).toBeNull();
    expect(latestSecondFactorAt(undefined)).toBeNull();
    expect(latestSecondFactorAt({ method: "totp", timestamp: NOW })).toBeNull();
  });
});

describe("isMfaFresh (12 hours)", () => {
  const amrAt = (timestamp: number) => [{ method: "totp", timestamp }];

  it("is fresh up to exactly 12 hours", () => {
    expect(isMfaFresh(amrAt(NOW - MFA_MAX_AGE_SECONDS), NOW)).toBe(true);
    expect(isMfaFresh(amrAt(NOW - MFA_MAX_AGE_SECONDS - 1), NOW)).toBe(false);
  });

  it("tolerates 5 minutes of clock skew, not more", () => {
    expect(isMfaFresh(amrAt(NOW + 300), NOW)).toBe(true);
    expect(isMfaFresh(amrAt(NOW + 301), NOW)).toBe(false);
  });
});

describe("isActivityFresh (30 minutes)", () => {
  it("is fresh up to exactly 30 minutes", () => {
    expect(isActivityFresh(NOW - IDLE_TIMEOUT_SECONDS, NOW)).toBe(true);
    expect(isActivityFresh(NOW - IDLE_TIMEOUT_SECONDS - 1, NOW)).toBe(false);
    expect(isActivityFresh(null, NOW)).toBe(false);
  });
});

describe("decideManageAccess", () => {
  const fresh = {
    aal: "aal2",
    amr: [
      { method: "otp", timestamp: NOW - 3600 },
      { method: "totp", timestamp: NOW - 60 },
    ],
    hasVerifiedFactor: true,
    lastActivityAt: NOW - 60,
    nowSeconds: NOW,
  };

  it("lets a fresh aal2 session through", () => {
    expect(decideManageAccess(fresh)).toEqual({ kind: "ok" });
  });

  it("sends aal1 without a factor to setup, with a factor to verify", () => {
    expect(
      decideManageAccess({ ...fresh, aal: "aal1", hasVerifiedFactor: false }),
    ).toEqual({
      kind: "enroll",
    });
    expect(decideManageAccess({ ...fresh, aal: "aal1" })).toEqual({
      kind: "verify",
      reason: "aal",
    });
    expect(decideManageAccess({ ...fresh, aal: undefined })).toEqual({
      kind: "verify",
      reason: "aal",
    });
  });

  it("requires re-verification after 12 hours, even while active", () => {
    expect(
      decideManageAccess({
        ...fresh,
        amr: [{ method: "totp", timestamp: NOW - MFA_MAX_AGE_SECONDS - 1 }],
      }),
    ).toEqual({ kind: "verify", reason: "mfa_expired" });
  });

  it("fails closed on missing or malformed amr", () => {
    expect(decideManageAccess({ ...fresh, amr: undefined })).toEqual({
      kind: "verify",
      reason: "mfa_expired",
    });
    expect(decideManageAccess({ ...fresh, amr: ["totp"] })).toEqual({
      kind: "verify",
      reason: "mfa_expired",
    });
  });

  it("requires re-verification after 30 idle minutes or without an activity cookie", () => {
    expect(
      decideManageAccess({ ...fresh, lastActivityAt: NOW - IDLE_TIMEOUT_SECONDS - 1 }),
    ).toEqual({ kind: "verify", reason: "idle" });
    expect(decideManageAccess({ ...fresh, lastActivityAt: null })).toEqual({
      kind: "verify",
      reason: "idle",
    });
  });
});
