import { describe, expect, it } from "vitest";

import {
  getAuthorizedPath,
  getAuthorizedPathWithReturn,
  resolveAuthContext,
  resolveManagerMfaContext,
  type AuthContext,
} from "./access";

const userId = "verified-user";
const authorized = {
  authorization_state: "authorized",
  organization_id: "organization-one",
  membership_role: "employee",
};

describe("database authorization context", () => {
  it("requires an independently verified user", () => {
    expect(resolveAuthContext(null, [authorized])).toEqual({ state: "anonymous" });
    expect(resolveAuthContext("", [authorized])).toEqual({ state: "anonymous" });
  });

  it.each(["employee", "manager"])("resolves only supported role %s", (role) => {
    expect(
      resolveAuthContext(userId, [{ ...authorized, membership_role: role }]),
    ).toEqual({
      state: "authorized",
      userId,
      organizationId: "organization-one",
      role,
    });
  });

  it.each([
    null,
    undefined,
    [],
    authorized,
    [null],
    ["authorized"],
    [{}],
    [{ ...authorized, authorization_state: "unauthorized" }],
    [{ ...authorized, authorization_state: "inactive" }],
    [{ ...authorized, authorization_state: "suspended" }],
    [{ ...authorized, membership_role: "admin" }],
    [{ ...authorized, membership_role: null }],
    [{ ...authorized, organization_id: null }],
    [{ ...authorized, organization_id: "" }],
    [{ ...authorized, organization_id: 42 }],
    [{ role: "manager", organizationId: "forged-organization", status: "active" }],
  ])("fails closed on absent or invalid context %j", (rows) => {
    expect(resolveAuthContext(userId, rows)).toEqual({ state: "unauthorized", userId });
  });

  it("does not select an arbitrary membership from multiple rows", () => {
    expect(
      resolveAuthContext(userId, [
        authorized,
        { ...authorized, organization_id: "other" },
      ]),
    ).toEqual({
      state: "unsupported",
      userId,
    });
  });

  it("preserves the database's multiple-membership denial without exposing tenants", () => {
    expect(
      resolveAuthContext(userId, [
        { ...authorized, authorization_state: "unsupported" },
      ]),
    ).toEqual({
      state: "unsupported",
      userId,
    });
  });
});

describe("role landing paths", () => {
  it.each<{ context: AuthContext; expected: string }>([
    { context: { state: "anonymous" }, expected: "/login" },
    { context: { state: "unauthorized", userId }, expected: "/unauthorized" },
    {
      context: { state: "unsupported", userId },
      expected: "/unauthorized?melding=meerdere-lidmaatschappen",
    },
    {
      context: { state: "authorized", userId, organizationId: "one", role: "employee" },
      expected: "/employee",
    },
    {
      context: { state: "authorized", userId, organizationId: "one", role: "manager" },
      expected: "/manager",
    },
    {
      context: {
        state: "manager_mfa_setup",
        userId,
        organizationId: "one",
        role: "manager",
      },
      expected: "/manager/security/setup",
    },
    {
      context: {
        state: "manager_mfa_verify",
        userId,
        organizationId: "one",
        role: "manager",
        factorId: "123e4567-e89b-42d3-a456-426614174000",
      },
      expected: "/manager/security/verify",
    },
    {
      context: {
        state: "manager_mfa_recovery_required",
        userId,
        organizationId: "one",
        role: "manager",
      },
      expected: "/manager/security/recovery-required",
    },
  ])("maps $context.state to $expected", ({ context, expected }) => {
    expect(getAuthorizedPath(context)).toBe(expected);
  });

  it("keeps only allowlisted manager destinations through MFA redirects", () => {
    const context: AuthContext = {
      state: "manager_mfa_verify",
      userId,
      organizationId: "one",
      role: "manager",
      factorId: "123e4567-e89b-42d3-a456-426614174000",
    };

    expect(getAuthorizedPathWithReturn(context, "/manager/exports-v2")).toBe(
      "/manager/security/verify?volgende=%2Fmanager%2Fexports-v2",
    );
    expect(getAuthorizedPathWithReturn(context, "https://attacker.test")).toBe(
      "/manager/security/verify?volgende=%2Fmanager",
    );
  });
});

describe("manager MFA context", () => {
  const manager = {
    state: "authorized",
    userId,
    organizationId: "organization-one",
    role: "manager",
  } as const;

  it.each([
    ["setup", "manager_mfa_setup"],
    ["recovery_required", "manager_mfa_recovery_required"],
  ])("maps provider state %s to %s", (manager_mfa_state, state) => {
    expect(resolveManagerMfaContext(manager, [{ manager_mfa_state }])).toMatchObject({
      state,
      role: "manager",
    });
  });

  it("accepts only a valid registered factor for verification", () => {
    expect(
      resolveManagerMfaContext(manager, [
        {
          manager_mfa_state: "verify",
          registered_factor_id: "123e4567-e89b-42d3-a456-426614174000",
        },
      ]),
    ).toMatchObject({ state: "manager_mfa_verify" });
  });

  it("keeps ready managers authorized", () => {
    expect(resolveManagerMfaContext(manager, [{ manager_mfa_state: "ready" }])).toBe(
      manager,
    );
  });

  it.each([
    null,
    [],
    [{}],
    [{ manager_mfa_state: "verify" }],
    [{ manager_mfa_state: "denied" }],
  ])("fails closed on malformed state %j", (rows) => {
    expect(resolveManagerMfaContext(manager, rows)).toEqual({
      state: "unauthorized",
      userId,
    });
  });
});
