import { beforeEach, describe, expect, it, vi } from "vitest";

import { nlBE } from "@/i18n/nl-BE";
import type { AuthContext } from "@/lib/auth/access";
import { initialAuthActionState } from "@/lib/auth/validation";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  rpc: vi.fn(),
  getAuthContext: vi.fn(),
  requireAuthFlow: vi.fn(),
  clearAuthFlowIntent: vi.fn(),
  deliverEmployeeInvitation: vi.fn(),
  getLocalSiteOrigin: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createServerClient,
}));
vi.mock("@/lib/auth/session", () => ({ getAuthContext: mocks.getAuthContext }));
vi.mock("@/lib/auth/flow-intent", () => ({
  requireAuthFlow: mocks.requireAuthFlow,
  clearAuthFlowIntent: mocks.clearAuthFlowIntent,
}));
vi.mock("@/lib/auth/invitation-delivery", () => ({
  deliverEmployeeInvitation: mocks.deliverEmployeeInvitation,
}));
vi.mock("@/lib/auth/local-only", () => ({
  getLocalSiteOrigin: mocks.getLocalSiteOrigin,
}));

import {
  acceptInvitationAction,
  forgotPasswordAction,
  inviteEmployeeAction,
  loginAction,
  logoutAction,
  resetPasswordAction,
} from "./actions";

const client = {
  auth: {
    signInWithPassword: mocks.signInWithPassword,
    signOut: mocks.signOut,
    resetPasswordForEmail: mocks.resetPasswordForEmail,
    updateUser: mocks.updateUser,
  },
  rpc: mocks.rpc,
};
const manager: AuthContext = {
  state: "authorized",
  userId: "verified-user",
  organizationId: "organization-one",
  role: "manager",
};
const employee: AuthContext = { ...manager, role: "employee" };
const invitationId = "10000000-0000-4000-8000-000000000001";
const password = "long unique password phrase";
const invitationFailure = { status: "error", message: nlBE.auth.invitationFailure };
const invitationUnavailable = {
  status: "error",
  message: nlBE.auth.invitationUnavailable,
};
const passwordFailure = { status: "error", message: nlBE.auth.passwordFailure };

function form(fields: Record<string, string | undefined> = {}): FormData {
  const result = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) result.set(key, value);
  }
  return result;
}

function passwordForm(fields: Record<string, string> = {}): FormData {
  return form({ password, passwordConfirmation: password, ...fields });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createServerClient.mockResolvedValue(client);
  mocks.signInWithPassword.mockResolvedValue({ error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
  mocks.updateUser.mockResolvedValue({ error: null });
  mocks.getAuthContext.mockResolvedValue(manager);
  mocks.requireAuthFlow.mockResolvedValue(true);
  mocks.clearAuthFlowIntent.mockResolvedValue(undefined);
  mocks.deliverEmployeeInvitation.mockResolvedValue(undefined);
  mocks.getLocalSiteOrigin.mockReturnValue("http://127.0.0.1:3100");
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name === "get_employee_invitation_state" ? "ready" : invitationId,
    error: null,
  }));
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
});

describe("login action", () => {
  it("passes only normalized credentials to Auth and redirects by database role", async () => {
    await expect(
      loginAction(
        initialAuthActionState,
        form({
          email: "  MANAGER@EXAMPLE.test  ",
          password: "  unchanged password  ",
          organization_id: "forged-organization",
          role: "employee",
          user_id: "forged-user",
          status: "active",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/manager");

    expect(mocks.signInWithPassword).toHaveBeenCalledExactlyOnceWith({
      email: "manager@example.test",
      password: "  unchanged password  ",
    });
    expect(mocks.getAuthContext).toHaveBeenCalledExactlyOnceWith(client);
    expect(mocks.clearAuthFlowIntent).toHaveBeenCalledOnce();
  });

  it.each([
    { email: "", password },
    { email: "not-an-email", password },
    { email: "worker@example.test", password: "" },
    { email: "worker@example.test", password: "x".repeat(129) },
  ])("uses the same generic error for invalid credentials", async (fields) => {
    await expect(loginAction(initialAuthActionState, form(fields))).resolves.toEqual({
      status: "error",
      message: nlBE.auth.loginFailure,
    });
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each([
    "Invalid login credentials",
    "User not found",
    "Email not confirmed",
    "Too many requests",
  ])("does not expose Auth error %s", async (message) => {
    mocks.signInWithPassword.mockResolvedValue({ error: { message } });
    await expect(
      loginAction(
        initialAuthActionState,
        form({ email: "worker@example.test", password }),
      ),
    ).resolves.toEqual({ status: "error", message: nlBE.auth.loginFailure });
    expect(mocks.getAuthContext).not.toHaveBeenCalled();
    expect(mocks.clearAuthFlowIntent).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each(["client", "auth", "intent", "context"])(
    "returns generic failure when %s throws",
    async (stage) => {
      const failure = new Error("private provider detail");
      if (stage === "client") mocks.createServerClient.mockRejectedValue(failure);
      if (stage === "auth") mocks.signInWithPassword.mockRejectedValue(failure);
      if (stage === "intent") mocks.clearAuthFlowIntent.mockRejectedValue(failure);
      if (stage === "context") mocks.getAuthContext.mockRejectedValue(failure);

      await expect(
        loginAction(
          initialAuthActionState,
          form({ email: "worker@example.test", password }),
        ),
      ).resolves.toEqual({ status: "error", message: nlBE.auth.loginFailure });
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );

  it.each([
    "/manager",
    "https://example.com",
    "//example.com",
    "/employee/extra",
    "/employee?next=/manager",
    "/reset-password",
  ])("cannot elevate an employee through next=%s", async (next) => {
    mocks.getAuthContext.mockResolvedValue(employee);
    await expect(
      loginAction(
        initialAuthActionState,
        form({ email: "worker@example.test", password, next }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/employee");
  });

  it("does not route a manager into the employee workspace", async () => {
    await expect(
      loginAction(
        initialAuthActionState,
        form({ email: "manager@example.test", password, next: "/employee" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/manager");
  });

  it.each<{ context: AuthContext; path: string }>([
    { context: employee, path: "/employee" },
    { context: manager, path: "/manager" },
    {
      context: {
        state: "manager_mfa_setup",
        userId: "verified-user",
        organizationId: "organization-one",
        role: "manager",
      },
      path: "/manager/security/setup?volgende=%2Fmanager",
    },
    {
      context: {
        state: "manager_mfa_verify",
        userId: "verified-user",
        organizationId: "organization-one",
        role: "manager",
        factorId: "123e4567-e89b-42d3-a456-426614174000",
      },
      path: "/manager/security/verify?volgende=%2Fmanager",
    },
    {
      context: {
        state: "manager_mfa_recovery_required",
        userId: "verified-user",
        organizationId: "organization-one",
        role: "manager",
      },
      path: "/manager/security/recovery-required?volgende=%2Fmanager",
    },
    {
      context: { state: "unauthorized", userId: "verified-user" },
      path: "/unauthorized",
    },
    {
      context: { state: "unsupported", userId: "verified-user" },
      path: "/unauthorized?melding=meerdere-lidmaatschappen",
    },
    { context: { state: "anonymous" }, path: "/login" },
  ])(
    "keeps server authorization authoritative for $path",
    async ({ context, path }) => {
      mocks.getAuthContext.mockResolvedValue(context);
      await expect(
        loginAction(
          initialAuthActionState,
          form({ email: "worker@example.test", password, next: "/manager" }),
        ),
      ).rejects.toThrow(`NEXT_REDIRECT:${path}`);
    },
  );
});

describe("logout action", () => {
  it("revokes the current session and clears flow proof before redirecting", async () => {
    await expect(logoutAction(initialAuthActionState)).rejects.toThrow(
      "NEXT_REDIRECT:/login",
    );
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
    expect(mocks.clearAuthFlowIntent).toHaveBeenCalledOnce();
    expect(mocks.signOut.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clearAuthFlowIntent.mock.invocationCallOrder[0]!,
    );
  });

  it("does not claim logout succeeded when session revocation fails", async () => {
    mocks.signOut.mockResolvedValue({
      error: { message: "private revocation detail" },
    });
    await expect(logoutAction(initialAuthActionState)).resolves.toEqual({
      status: "error",
      message: nlBE.auth.logoutFailure,
    });
    expect(mocks.clearAuthFlowIntent).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each(["client", "auth", "intent"])(
    "handles %s exceptions without claiming successful logout",
    async (stage) => {
      const failure = new Error("private provider detail");
      if (stage === "client") mocks.createServerClient.mockRejectedValue(failure);
      if (stage === "auth") mocks.signOut.mockRejectedValue(failure);
      if (stage === "intent") mocks.clearAuthFlowIntent.mockRejectedValue(failure);
      await expect(logoutAction(initialAuthActionState)).resolves.toEqual({
        status: "error",
        message: nlBE.auth.logoutFailure,
      });
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );
});

describe("password recovery request", () => {
  it("uses the configured local callback, not a browser-supplied redirect", async () => {
    await expect(
      forgotPasswordAction(
        initialAuthActionState,
        form({
          email: "  Worker@EXAMPLE.test  ",
          redirectTo: "https://example.com",
          next: "//example.com",
        }),
      ),
    ).resolves.toEqual({ status: "success", message: nlBE.auth.recoverySuccess });
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledExactlyOnceWith(
      "worker@example.test",
      { redirectTo: "http://127.0.0.1:3100/auth/callback" },
    );
  });

  it("validates email before contacting Auth", async () => {
    await expect(
      forgotPasswordAction(initialAuthActionState, form({ email: "invalid" })),
    ).resolves.toMatchObject({
      status: "error",
      message: nlBE.auth.invalidForm,
      fieldErrors: { email: nlBE.authValidation.email },
    });
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { message: "User not found" },
    { message: "Email rate limit exceeded" },
    { message: "SMTP unavailable" },
  ])("keeps account existence and delivery errors indistinguishable", async (error) => {
    mocks.resetPasswordForEmail.mockResolvedValue({ error });
    await expect(
      forgotPasswordAction(
        initialAuthActionState,
        form({ email: "worker@example.test" }),
      ),
    ).resolves.toEqual({ status: "success", message: nlBE.auth.recoverySuccess });
  });

  it.each(["client", "origin", "auth"])(
    "keeps %s exceptions indistinguishable from success",
    async (stage) => {
      const failure = new Error("private provider detail");
      if (stage === "client") mocks.createServerClient.mockRejectedValue(failure);
      if (stage === "origin")
        mocks.getLocalSiteOrigin.mockImplementation(() => {
          throw failure;
        });
      if (stage === "auth") mocks.resetPasswordForEmail.mockRejectedValue(failure);
      await expect(
        forgotPasswordAction(
          initialAuthActionState,
          form({ email: "worker@example.test" }),
        ),
      ).resolves.toEqual({ status: "success", message: nlBE.auth.recoverySuccess });
    },
  );
});

describe("manager employee invitation action", () => {
  it("uses the manager database context and forwards only allowed invitation fields", async () => {
    await expect(
      inviteEmployeeAction(
        initialAuthActionState,
        form({
          email: "  New.Employee@EXAMPLE.test  ",
          displayName: "  Test Medewerker  ",
          employeeCode: "  E-01  ",
          organization_id: "forged-organization",
          role: "manager",
          user_id: "forged-user",
          membership_id: "forged-membership",
          status: "active",
          expires_at: "2999-01-01",
        }),
      ),
    ).resolves.toEqual({ status: "success", message: nlBE.auth.invitationSuccess });

    expect(mocks.getAuthContext).toHaveBeenCalledExactlyOnceWith(client);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("create_employee_invitation", {
      employee_email: "new.employee@example.test",
      display_name: "Test Medewerker",
      employee_code: "E-01",
    });
    expect(mocks.deliverEmployeeInvitation).toHaveBeenCalledExactlyOnceWith(
      invitationId,
    );
    expect(mocks.getAuthContext.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rpc.mock.invocationCallOrder[0]!,
    );
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deliverEmployeeInvitation.mock.invocationCallOrder[0]!,
    );
  });

  it("supports omitted optional profile fields", async () => {
    await inviteEmployeeAction(
      initialAuthActionState,
      form({ email: "worker@example.test" }),
    );
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("create_employee_invitation", {
      employee_email: "worker@example.test",
    });
  });

  it.each<AuthContext>([
    { state: "anonymous" },
    { state: "unauthorized", userId: "verified-user" },
    { state: "unsupported", userId: "verified-user" },
    employee,
  ])("rejects non-manager context $state before invitation writes", async (context) => {
    mocks.getAuthContext.mockResolvedValue(context);
    await expect(
      inviteEmployeeAction(
        initialAuthActionState,
        form({ email: "worker@example.test", role: "manager", status: "active" }),
      ),
    ).resolves.toEqual(invitationFailure);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.deliverEmployeeInvitation).not.toHaveBeenCalled();
  });

  it.each([
    { email: "invalid" },
    { email: "worker@example.test", displayName: "x".repeat(101) },
    { email: "worker@example.test", employeeCode: "x".repeat(33) },
  ])("validates invitation fields before writing", async (fields) => {
    await expect(
      inviteEmployeeAction(initialAuthActionState, form(fields)),
    ).resolves.toMatchObject({ status: "error", message: nlBE.auth.invalidForm });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.deliverEmployeeInvitation).not.toHaveBeenCalled();
  });

  it("uses the same success for a duplicate without delivering another invitation", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(
      inviteEmployeeAction(
        initialAuthActionState,
        form({ email: "worker@example.test" }),
      ),
    ).resolves.toEqual({ status: "success", message: nlBE.auth.invitationSuccess });
    expect(mocks.deliverEmployeeInvitation).not.toHaveBeenCalled();
  });

  it("does not deliver an invitation rejected by the database", async () => {
    mocks.rpc.mockResolvedValue({
      data: invitationId,
      error: { message: "private policy detail" },
    });
    await expect(
      inviteEmployeeAction(
        initialAuthActionState,
        form({ email: "worker@example.test" }),
      ),
    ).resolves.toEqual(invitationFailure);
    expect(mocks.deliverEmployeeInvitation).not.toHaveBeenCalled();
  });

  it.each(["client", "context", "database", "delivery"])(
    "returns generic failure when %s throws",
    async (stage) => {
      const failure = new Error("private provider detail");
      if (stage === "client") mocks.createServerClient.mockRejectedValue(failure);
      if (stage === "context") mocks.getAuthContext.mockRejectedValue(failure);
      if (stage === "database") mocks.rpc.mockRejectedValue(failure);
      if (stage === "delivery")
        mocks.deliverEmployeeInvitation.mockRejectedValue(failure);
      await expect(
        inviteEmployeeAction(
          initialAuthActionState,
          form({ email: "worker@example.test" }),
        ),
      ).resolves.toEqual(invitationFailure);
    },
  );
});

describe("invitation acceptance action", () => {
  it("requires verified invitation proof, sets a password, then accepts without browser authority", async () => {
    mocks.getAuthContext.mockResolvedValue(employee);
    await expect(
      acceptInvitationAction(
        initialAuthActionState,
        passwordForm({
          email: "someone-else@example.test",
          user_id: "forged-user",
          organization_id: "forged-organization",
          role: "manager",
          invitation_id: "forged-invitation",
          token_hash: "browser-value",
          type: "invite",
          next: "https://example.com",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/employee");

    expect(mocks.requireAuthFlow).toHaveBeenCalledExactlyOnceWith("invite", client);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "get_employee_invitation_state");
    expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith({ password });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "accept_employee_invitation");
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.clearAuthFlowIntent).toHaveBeenCalledOnce();
    expect(mocks.requireAuthFlow.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rpc.mock.invocationCallOrder[0]!,
    );
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateUser.mock.invocationCallOrder[0]!,
    );
    expect(mocks.updateUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rpc.mock.invocationCallOrder[1]!,
    );
    expect(mocks.rpc.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.clearAuthFlowIntent.mock.invocationCallOrder[0]!,
    );
  });

  it("rejects direct visits, wrong-purpose proof, or replay without changing a password", async () => {
    mocks.requireAuthFlow.mockResolvedValue(false);
    await expect(
      acceptInvitationAction(
        initialAuthActionState,
        passwordForm({ type: "invite", token_hash: "forged" }),
      ),
    ).resolves.toEqual(invitationUnavailable);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.clearAuthFlowIntent).not.toHaveBeenCalled();
  });

  it.each([
    { password: "too short", passwordConfirmation: "too short" },
    { password, passwordConfirmation: "different password" },
  ])("validates passwords before calling the database or Auth", async (fields) => {
    await expect(
      acceptInvitationAction(initialAuthActionState, form(fields)),
    ).resolves.toMatchObject({ status: "error", message: nlBE.auth.invalidForm });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it.each(["unavailable", "unsupported", null, "expired", "revoked", "accepted"])(
    "does not change a password when invitation preflight is %s",
    async (data) => {
      mocks.rpc.mockResolvedValue({ data, error: null });
      await expect(
        acceptInvitationAction(initialAuthActionState, passwordForm()),
      ).resolves.toEqual(invitationUnavailable);
      expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
        "get_employee_invitation_state",
      );
      expect(mocks.updateUser).not.toHaveBeenCalled();
    },
  );

  it("does not trust ready state returned with a database error", async () => {
    mocks.rpc.mockResolvedValue({
      data: "ready",
      error: { message: "private database detail" },
    });
    await expect(
      acceptInvitationAction(initialAuthActionState, passwordForm()),
    ).resolves.toEqual(invitationUnavailable);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("does not activate membership if the password update fails", async () => {
    mocks.updateUser.mockResolvedValue({
      error: { message: "private password detail" },
    });
    await expect(
      acceptInvitationAction(initialAuthActionState, passwordForm()),
    ).resolves.toEqual(passwordFailure);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("get_employee_invitation_state");
    expect(mocks.clearAuthFlowIntent).not.toHaveBeenCalled();
  });

  it.each([
    { data: null, error: null },
    { data: null, error: { message: "invitation no longer pending" } },
  ])("handles an acceptance race without claiming activation", async (acceptance) => {
    mocks.rpc
      .mockResolvedValueOnce({ data: "ready", error: null })
      .mockResolvedValueOnce(acceptance);
    await expect(
      acceptInvitationAction(initialAuthActionState, passwordForm()),
    ).resolves.toEqual(invitationUnavailable);
    expect(mocks.clearAuthFlowIntent).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each(["client", "proof", "preflight", "password", "acceptance"])(
    "handles %s exceptions without exposing provider details",
    async (stage) => {
      const failure = new Error("private provider detail");
      if (stage === "client") mocks.createServerClient.mockRejectedValue(failure);
      if (stage === "proof") mocks.requireAuthFlow.mockRejectedValue(failure);
      if (stage === "preflight") mocks.rpc.mockRejectedValue(failure);
      if (stage === "password") mocks.updateUser.mockRejectedValue(failure);
      if (stage === "acceptance")
        mocks.rpc
          .mockResolvedValueOnce({ data: "ready", error: null })
          .mockRejectedValueOnce(failure);
      await expect(
        acceptInvitationAction(initialAuthActionState, passwordForm()),
      ).resolves.toEqual(
        stage === "password" ? passwordFailure : invitationUnavailable,
      );
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );
});

describe("password reset action", () => {
  it.each([
    {
      context: {
        state: "manager_mfa_verify",
        userId: "verified-user",
        organizationId: "organization-one",
        role: "manager",
        factorId: "123e4567-e89b-42d3-a456-426614174000",
      } satisfies AuthContext,
      path: "/manager/security/verify",
    },
    { context: employee, path: "/employee" },
  ])(
    "updates the password, revokes other sessions, and routes to $path",
    async ({ context, path }) => {
      mocks.getAuthContext.mockResolvedValue(context);
      await expect(
        resetPasswordAction(
          initialAuthActionState,
          passwordForm({
            user_id: "forged-user",
            role: "manager",
            next: "https://example.com",
          }),
        ),
      ).rejects.toThrow(`NEXT_REDIRECT:${path}`);
      expect(mocks.requireAuthFlow).toHaveBeenCalledExactlyOnceWith("recovery", client);
      expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith({ password });
      expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "others" });
      expect(mocks.clearAuthFlowIntent).toHaveBeenCalledOnce();
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.requireAuthFlow.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.updateUser.mock.invocationCallOrder[0]!,
      );
      expect(mocks.updateUser.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.signOut.mock.invocationCallOrder[0]!,
      );
      expect(mocks.signOut.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.clearAuthFlowIntent.mock.invocationCallOrder[0]!,
      );
    },
  );

  it("requires recovery proof rather than an ordinary authenticated session", async () => {
    mocks.requireAuthFlow.mockResolvedValue(false);
    await expect(
      resetPasswordAction(initialAuthActionState, passwordForm({ type: "recovery" })),
    ).resolves.toEqual({ status: "error", message: nlBE.auth.recoveryUnavailable });
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.clearAuthFlowIntent).not.toHaveBeenCalled();
  });

  it("does not update a mismatched new password", async () => {
    await expect(
      resetPasswordAction(
        initialAuthActionState,
        passwordForm({ passwordConfirmation: "different password" }),
      ),
    ).resolves.toMatchObject({ status: "error", message: nlBE.auth.invalidForm });
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("does not revoke sessions or consume proof if password update fails", async () => {
    mocks.updateUser.mockResolvedValue({
      error: { message: "private password detail" },
    });
    await expect(
      resetPasswordAction(initialAuthActionState, passwordForm()),
    ).resolves.toEqual(passwordFailure);
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.clearAuthFlowIntent).not.toHaveBeenCalled();
  });

  it("does not report completed reset if other-session revocation fails", async () => {
    mocks.signOut.mockResolvedValue({
      error: { message: "private revocation detail" },
    });
    await expect(
      resetPasswordAction(initialAuthActionState, passwordForm()),
    ).resolves.toEqual(passwordFailure);
    expect(mocks.clearAuthFlowIntent).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("still denies access when the recovered account lacks an active membership", async () => {
    mocks.getAuthContext.mockResolvedValue({
      state: "unauthorized",
      userId: "verified-user",
    });
    await expect(
      resetPasswordAction(initialAuthActionState, passwordForm()),
    ).rejects.toThrow("NEXT_REDIRECT:/unauthorized");
  });

  it.each(["client", "proof", "password", "revocation", "intent", "context"])(
    "handles %s exceptions without exposing provider details",
    async (stage) => {
      const failure = new Error("private provider detail");
      if (stage === "client") mocks.createServerClient.mockRejectedValue(failure);
      if (stage === "proof") mocks.requireAuthFlow.mockRejectedValue(failure);
      if (stage === "password") mocks.updateUser.mockRejectedValue(failure);
      if (stage === "revocation") mocks.signOut.mockRejectedValue(failure);
      if (stage === "intent") mocks.clearAuthFlowIntent.mockRejectedValue(failure);
      if (stage === "context") mocks.getAuthContext.mockRejectedValue(failure);
      await expect(
        resetPasswordAction(initialAuthActionState, passwordForm()),
      ).resolves.toEqual(
        stage === "client" || stage === "proof"
          ? { status: "error", message: nlBE.auth.recoveryUnavailable }
          : passwordFailure,
      );
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );
});
