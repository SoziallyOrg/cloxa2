import { describe, expect, it } from "vitest";

import { nlBE } from "@/i18n/nl-BE";

import {
  getFormText,
  invitationSchema,
  loginSchema,
  passwordSchema,
  recoverySchema,
  validationState,
} from "./validation";

describe("credential validation", () => {
  it("normalizes email without changing the password", () => {
    expect(
      loginSchema.parse({
        email: "  Worker@EXAMPLE.test  ",
        password: "  exact password  ",
      }),
    ).toEqual({
      email: "worker@example.test",
      password: "  exact password  ",
    });
    expect(recoverySchema.parse({ email: "  Worker@EXAMPLE.test  " })).toEqual({
      email: "worker@example.test",
    });
  });

  it.each(["", "invalid", "worker@", `${"a".repeat(255)}@example.test`])(
    "rejects invalid email %s",
    (email) => {
      expect(loginSchema.safeParse({ email, password: "password" }).success).toBe(
        false,
      );
      expect(recoverySchema.safeParse({ email }).success).toBe(false);
    },
  );

  it("allows existing passwords shorter than the new-password policy", () => {
    expect(
      loginSchema.safeParse({ email: "worker@example.test", password: "existing" })
        .success,
    ).toBe(true);
  });

  it.each(["", "x".repeat(129)])(
    "rejects empty or oversized login passwords",
    (password) => {
      expect(
        loginSchema.safeParse({ email: "worker@example.test", password }).success,
      ).toBe(false);
    },
  );
});

describe("employee invitation validation", () => {
  it("normalizes optional employee fields and drops unrecognized authority claims", () => {
    expect(
      invitationSchema.parse({
        email: "  Employee@EXAMPLE.test  ",
        displayName: "  Test Medewerker  ",
        employeeCode: "  E-01  ",
        organizationId: "forged-organization",
        role: "manager",
        userId: "someone-else",
        status: "active",
      }),
    ).toEqual({
      email: "employee@example.test",
      displayName: "Test Medewerker",
      employeeCode: "E-01",
    });
  });

  it("converts blank optional fields to null", () => {
    expect(
      invitationSchema.parse({
        email: "employee@example.test",
        displayName: "  ",
        employeeCode: "",
      }),
    ).toEqual({
      email: "employee@example.test",
      displayName: null,
      employeeCode: null,
    });
  });

  it.each([
    { displayName: "x".repeat(101), employeeCode: "" },
    { displayName: "", employeeCode: "x".repeat(33) },
  ])("rejects oversized profile fields", (fields) => {
    expect(
      invitationSchema.safeParse({ email: "employee@example.test", ...fields }).success,
    ).toBe(false);
  });
});

describe("new password validation", () => {
  it.each([12, 128])("accepts matching passwords at length %i", (length) => {
    const password = "x".repeat(length);
    expect(passwordSchema.parse({ password, passwordConfirmation: password })).toEqual({
      password,
      passwordConfirmation: password,
    });
  });

  it.each([0, 11, 129])("rejects new password length %i", (length) => {
    const password = "x".repeat(length);
    expect(
      passwordSchema.safeParse({ password, passwordConfirmation: password }).success,
    ).toBe(false);
  });

  it("preserves leading and trailing password whitespace", () => {
    const password = "  long password phrase  ";
    expect(
      passwordSchema.parse({ password, passwordConfirmation: password }).password,
    ).toBe(password);
  });

  it("reports mismatched confirmation in centralized Dutch copy", () => {
    const parsed = passwordSchema.safeParse({
      password: "long password phrase",
      passwordConfirmation: "other password phrase",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("Expected rejected confirmation");

    expect(validationState(parsed.error)).toEqual({
      message: nlBE.auth.invalidForm,
      status: "error",
      fieldErrors: { passwordConfirmation: nlBE.authValidation.passwordConfirmation },
    });
  });

  it("does not return raw validation details or submitted values", () => {
    const parsed = invitationSchema.safeParse({
      email: "private-invalid-value",
      displayName: "x".repeat(101),
      employeeCode: "x".repeat(33),
    });
    if (parsed.success) throw new Error("Expected rejected fields");

    const state = validationState(parsed.error);
    expect(state).toEqual({
      message: nlBE.auth.invalidForm,
      status: "error",
      fieldErrors: {
        email: nlBE.authValidation.email,
        displayName: nlBE.authValidation.displayName,
        employeeCode: nlBE.authValidation.employeeCode,
      },
    });
    expect(JSON.stringify(state)).not.toContain("private-invalid-value");
  });
});

describe("form field extraction", () => {
  it("returns only text, not file payloads", () => {
    const formData = new FormData();
    formData.set("email", "worker@example.test");
    formData.set("password", new Blob(["not-a-password"]), "password.txt");

    expect(getFormText(formData, "email")).toBe("worker@example.test");
    expect(getFormText(formData, "password")).toBe("");
    expect(getFormText(formData, "absent")).toBe("");
  });
});
