import { describe, expect, it } from "vitest";

import {
  chooseMembership,
  destinationFor,
  homeFor,
  isPrivileged,
  isRole,
  type ActiveMembership,
} from "./routing";

const membership = (organizationId: string, role: ActiveMembership["role"]) => ({
  id: `m-${organizationId}`,
  organizationId,
  organizationName: `Org ${organizationId}`,
  role,
});

describe("roles", () => {
  it("knows which roles are privileged", () => {
    expect(isPrivileged("owner")).toBe(true);
    expect(isPrivileged("admin")).toBe(true);
    expect(isPrivileged("manager")).toBe(true);
    expect(isPrivileged("employee")).toBe(false);
  });

  it("rejects unknown roles", () => {
    expect(isRole("employee")).toBe(true);
    expect(isRole("superuser")).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});

describe("homeFor", () => {
  it("sends privileged roles to /manage", () => {
    expect(homeFor("owner", true)).toBe("/manage");
    expect(homeFor("manager", false)).toBe("/manage");
  });

  it("sends employees with an employee row to /app, others to no access", () => {
    expect(homeFor("employee", true)).toBe("/app");
    expect(homeFor("employee", false)).toBe("/geen-toegang");
  });
});

describe("chooseMembership", () => {
  const a = membership("a", "employee");
  const b = membership("b", "manager");

  it("has nothing to choose without memberships", () => {
    expect(chooseMembership([], "a")).toEqual({ kind: "none" });
  });

  it("uses a single membership directly, whatever the cookie says", () => {
    expect(chooseMembership([a], null)).toEqual({ kind: "selected", membership: a });
    expect(chooseMembership([a], "b")).toEqual({ kind: "selected", membership: a });
  });

  it("asks to choose between several unless the cookie names one of them", () => {
    expect(chooseMembership([a, b], null).kind).toBe("choose");
    expect(chooseMembership([a, b], "elsewhere").kind).toBe("choose");
    expect(chooseMembership([a, b], "b")).toEqual({ kind: "selected", membership: b });
  });
});

describe("destinationFor", () => {
  it("routes each state", () => {
    expect(destinationFor({ kind: "anonymous" })).toBe("/login");
    expect(destinationFor({ kind: "none" })).toBe("/geen-toegang");
    expect(destinationFor({ kind: "choose" })).toBe("/kies-organisatie");
    expect(
      destinationFor({ kind: "member", role: "employee", hasEmployee: true }),
    ).toBe("/app");
    expect(destinationFor({ kind: "member", role: "admin", hasEmployee: false })).toBe(
      "/manage",
    );
  });
});
