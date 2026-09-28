import { describe, expect, it } from "vitest";

import { validateInviteForm, type InviteFormInput } from "./invite-form";

const VALID: InviteFormInput = {
  displayName: "Jan Jansen",
  email: "jan@demo.test",
  statute: "bediende",
  role: "employee",
  siteIds: ["11111111-1111-4111-8111-111111111111"],
};

describe("validateInviteForm", () => {
  it("accepts a valid employee invite", () => {
    const result = validateInviteForm(VALID, false);
    expect(result.ok).toBe(true);
    expect(result.values?.email).toBe("jan@demo.test");
  });

  it("lowercases the email", () => {
    const result = validateInviteForm({ ...VALID, email: "JAN@Demo.Test" }, false);
    expect(result.values?.email).toBe("jan@demo.test");
  });

  it("rejects an empty name", () => {
    const result = validateInviteForm({ ...VALID, displayName: "  " }, false);
    expect(result.ok).toBe(false);
    expect(result.fieldErrors["displayName"]).toBeDefined();
  });

  it("rejects an invalid email", () => {
    const result = validateInviteForm({ ...VALID, email: "not-an-email" }, false);
    expect(result.ok).toBe(false);
    expect(result.fieldErrors["email"]).toBeDefined();
  });

  it("requires at least one site", () => {
    const result = validateInviteForm({ ...VALID, siteIds: [] }, false);
    expect(result.ok).toBe(false);
    expect(result.fieldErrors["siteIds"]).toBeDefined();
  });

  it("blocks a manager from inviting a manager or admin", () => {
    const result = validateInviteForm({ ...VALID, role: "manager" }, false);
    expect(result.ok).toBe(false);
    expect(result.fieldErrors["role"]).toBe("role_not_allowed");
  });

  it("allows an owner/admin to invite a manager", () => {
    const result = validateInviteForm({ ...VALID, role: "manager" }, true);
    expect(result.ok).toBe(true);
    expect(result.values?.role).toBe("manager");
  });

  it("treats a blank employee code as absent", () => {
    const result = validateInviteForm({ ...VALID, employeeCode: "  " }, false);
    expect(result.values?.employeeCode).toBeUndefined();
  });
});
