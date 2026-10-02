import { describe, expect, it } from "vitest";

import { shouldShowRoleSwitch } from "./role-switch";

describe("shouldShowRoleSwitch", () => {
  it("shows only for someone with an employee record who can also manage", () => {
    expect(shouldShowRoleSwitch({ hasEmployee: true, canManage: true })).toBe(true);
  });

  it("hides for a plain employee", () => {
    expect(shouldShowRoleSwitch({ hasEmployee: true, canManage: false })).toBe(false);
  });

  it("hides for a manager without an employee record (nothing to clock)", () => {
    expect(shouldShowRoleSwitch({ hasEmployee: false, canManage: true })).toBe(false);
  });

  it("hides when neither applies", () => {
    expect(shouldShowRoleSwitch({ hasEmployee: false, canManage: false })).toBe(false);
  });
});
