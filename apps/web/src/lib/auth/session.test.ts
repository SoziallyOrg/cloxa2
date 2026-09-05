import type { Database } from "@cloxa/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createServerClient,
}));

import { getAuthContext, requireRole } from "./session";

const userId = "verified-user";
const client = {
  auth: { getUser: mocks.getUser },
  rpc: mocks.rpc,
} as unknown as SupabaseClient<Database>;
const membership = {
  authorization_state: "authorized",
  membership_role: "manager",
  organization_id: "organization-one",
};

function mockRpcFor(
  authContext: object = membership,
  mfaStatus: object = { manager_mfa_state: "ready", registered_factor_id: null },
) {
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name === "get_manager_mfa_status" ? [mfaStatus] : [authContext],
    error: null,
  }));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createServerClient.mockResolvedValue(client);
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  mockRpcFor();
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
});

describe("server auth context", () => {
  it("verifies the Auth user and reads authorization using a parameterless RPC", async () => {
    await expect(getAuthContext()).resolves.toEqual({
      state: "authorized",
      role: "manager",
      organizationId: "organization-one",
      userId,
    });
    expect(mocks.createServerClient).toHaveBeenCalledOnce();
    expect(mocks.getUser).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "get_auth_context");
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "get_manager_mfa_status");
    expect(mocks.getUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rpc.mock.invocationCallOrder[0]!,
    );
  });

  it("reuses the current action client instead of creating another session", async () => {
    await getAuthContext(client);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });

  it.each([
    { data: { user: null }, error: null },
    { data: { user: { id: userId } }, error: { message: "expired session" } },
  ])("denies an unverified session without querying memberships", async (result) => {
    mocks.getUser.mockResolvedValue(result);
    await expect(getAuthContext()).resolves.toEqual({ state: "anonymous" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not grant access from user or app metadata", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: userId,
          user_metadata: {
            role: "manager",
            organization_id: "forged",
            status: "active",
          },
          app_metadata: { role: "manager" },
        },
      },
      error: null,
    });
    mocks.rpc.mockResolvedValue({
      data: [{ authorization_state: "unauthorized" }],
      error: null,
    });
    await expect(getAuthContext()).resolves.toEqual({ state: "unauthorized", userId });
  });

  it("ignores rows returned together with a database error", async () => {
    mocks.rpc.mockResolvedValue({
      data: [membership],
      error: { message: "database unavailable" },
    });
    await expect(getAuthContext()).resolves.toEqual({ state: "unauthorized", userId });
  });

  it.each(["client", "auth", "database"])(
    "fails closed when %s throws",
    async (stage) => {
      const failure = new Error("private provider detail");
      if (stage === "client") mocks.createServerClient.mockRejectedValue(failure);
      if (stage === "auth") mocks.getUser.mockRejectedValue(failure);
      if (stage === "database") mocks.rpc.mockRejectedValue(failure);

      await expect(getAuthContext()).resolves.toEqual(
        stage === "database"
          ? { state: "unauthorized", userId }
          : { state: "anonymous" },
      );
    },
  );
});

describe("server page role enforcement", () => {
  it.each(["manager", "employee"] as const)(
    "permits an active %s only in their own workspace",
    async (role) => {
      mocks.rpc.mockResolvedValue({
        data: [{ ...membership, membership_role: role }],
        error: null,
      });
      if (role === "manager") {
        mockRpcFor({ ...membership, membership_role: role });
      }
      await expect(requireRole(role)).resolves.toMatchObject({
        state: "authorized",
        role,
      });
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );

  it.each([
    { own: "manager", requested: "employee" },
    { own: "employee", requested: "manager" },
  ] as const)("denies $own visiting $requested", async ({ own, requested }) => {
    mockRpcFor({ ...membership, membership_role: own });
    await expect(requireRole(requested)).rejects.toThrow("NEXT_REDIRECT:/unauthorized");
  });

  it("sends anonymous visitors to login", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(requireRole("manager")).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("denies missing, inactive, or suspended membership as reported by the database", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          authorization_state: "unauthorized",
          organization_id: null,
          membership_role: null,
        },
      ],
      error: null,
    });
    await expect(requireRole("employee")).rejects.toThrow(
      "NEXT_REDIRECT:/unauthorized",
    );
  });

  it("shows the explicit unsupported state for multiple active memberships", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          authorization_state: "unsupported",
          organization_id: null,
          membership_role: null,
        },
      ],
      error: null,
    });
    await expect(requireRole("manager")).rejects.toThrow(
      "NEXT_REDIRECT:/unauthorized?melding=meerdere-lidmaatschappen",
    );
  });

  it.each([
    ["setup", "/manager/security/setup?volgende=%2Fmanager%2Fteam"],
    ["verify", "/manager/security/verify?volgende=%2Fmanager%2Fteam"],
    [
      "recovery_required",
      "/manager/security/recovery-required?volgende=%2Fmanager%2Fteam",
    ],
  ])(
    "routes manager MFA state %s before workspace access",
    async (manager_mfa_state, path) => {
      mockRpcFor(membership, {
        manager_mfa_state,
        registered_factor_id:
          manager_mfa_state === "verify"
            ? "123e4567-e89b-42d3-a456-426614174000"
            : null,
        recovery_state:
          manager_mfa_state === "recovery_required" ? "operator_action_required" : null,
      });

      await expect(requireRole("manager", "/manager/team")).rejects.toThrow(
        `NEXT_REDIRECT:${path}`,
      );
    },
  );

  it("fails closed when the manager MFA status query errors", async () => {
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "get_auth_context"
        ? { data: [membership], error: null }
        : { data: null, error: { message: "private provider detail" } },
    );

    await expect(getAuthContext()).resolves.toEqual({ state: "unauthorized", userId });
  });
});
