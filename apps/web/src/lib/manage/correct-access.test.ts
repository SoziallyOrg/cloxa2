import { describe, expect, it } from "vitest";

import type { Role } from "@/lib/auth/routing";

import { mayCorrect } from "./correct-access";

const ME = "me";
const THEM = "them";

const viewer = (role: Role, employeeId: string | null = null) => ({ role, employeeId });
const target = (
  role: Role | undefined,
  userId: string | null = "u",
  inactive = false,
) => ({
  employeeId: THEM,
  userId,
  role,
  inactive,
});

describe("mayCorrect", () => {
  it("never offers it for someone who left or was anonymised", () => {
    expect(mayCorrect(viewer("owner"), target("employee", "u", true))).toBe(false);
  });

  it("only an owner corrects their own record", () => {
    const own = { employeeId: ME, userId: "u", role: undefined };
    expect(mayCorrect(viewer("owner", ME), own)).toBe(true);
    expect(mayCorrect(viewer("admin", ME), own)).toBe(false);
    expect(mayCorrect(viewer("manager", ME), own)).toBe(false);
  });

  it("an owner corrects anyone else", () => {
    for (const role of ["owner", "admin", "manager", "employee"] as const) {
      expect(mayCorrect(viewer("owner", ME), target(role))).toBe(true);
    }
  });

  it("an admin corrects anyone but an owner", () => {
    expect(mayCorrect(viewer("admin", ME), target("owner"))).toBe(false);
    expect(mayCorrect(viewer("admin", ME), target("admin"))).toBe(true);
    expect(mayCorrect(viewer("admin", ME), target("manager"))).toBe(true);
    expect(mayCorrect(viewer("admin", ME), target("employee"))).toBe(true);
    expect(mayCorrect(viewer("admin", ME), target(undefined, null))).toBe(true);
  });

  it("a manager corrects employees and people without a login", () => {
    expect(mayCorrect(viewer("manager", ME), target("employee"))).toBe(true);
    expect(mayCorrect(viewer("manager", ME), target(undefined, null))).toBe(true);
    expect(mayCorrect(viewer("manager", ME), target("manager"))).toBe(false);
    expect(mayCorrect(viewer("manager", ME), target("admin"))).toBe(false);
    expect(mayCorrect(viewer("manager", ME), target("owner"))).toBe(false);
  });

  it("a manager is offered it when a login's role is unreadable (the database decides)", () => {
    expect(mayCorrect(viewer("manager", ME), target(undefined, "u"))).toBe(true);
  });

  it("an employee is never offered it", () => {
    expect(mayCorrect(viewer("employee", ME), target("employee"))).toBe(false);
  });
});
