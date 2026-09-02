import { describe, expect, it } from "vitest";

import { getAuthorizedPath, resolveAuthContext, type AuthContext } from "./access";

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
  ])("maps $context.state to $expected", ({ context, expected }) => {
    expect(getAuthorizedPath(context)).toBe(expected);
  });
});
