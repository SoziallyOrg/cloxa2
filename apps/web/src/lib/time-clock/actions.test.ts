import { beforeEach, describe, expect, it, vi } from "vitest";

import { nlBE } from "@/i18n/nl-BE";
import type { AuthContext } from "@/lib/auth/access";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getAuthContext: vi.fn(),
  revalidatePath: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createServerClient,
}));
vi.mock("@/lib/auth/session", () => ({ getAuthContext: mocks.getAuthContext }));

import { submitTimeClockAction } from "@/lib/time-clock/actions";
import { initialTimeClockActionState } from "@/lib/time-clock/model";

const requestId = "10000000-0000-4000-8000-000000000001";
const client = { rpc: mocks.rpc };
const employee: AuthContext = {
  organizationId: "organization-one",
  role: "employee",
  state: "authorized",
  userId: "verified-user",
};

function clockForm(operation = "clock_in", id = requestId) {
  const form = new FormData();
  form.set("operation", operation);
  form.set("request_id", id);
  form.set("organization_id", "forged-organization");
  form.set("membership_id", "forged-membership");
  form.set("worksite_id", "forged-worksite");
  form.set("user_id", "forged-user");
  form.set("role", "manager");
  form.set("started_at", "2000-01-01T00:00:00Z");
  form.set("ended_at", "2999-01-01T00:00:00Z");
  return form;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createServerClient.mockResolvedValue(client);
  mocks.getAuthContext.mockResolvedValue(employee);
  mocks.rpc.mockResolvedValue({
    data: [
      {
        did_transition: true,
        ended_at: null,
        request_id: requestId,
        result_code: "started",
        started_at: "2026-09-02T08:00:00Z",
        time_entry_id: "20000000-0000-4000-8000-000000000001",
        worksite_id: "30000000-0000-4000-8000-000000000001",
      },
    ],
    error: null,
  });
});

describe("employee time-clock action", () => {
  it("authorizes employee and passes only client request ID to clock-in RPC", async () => {
    await expect(
      submitTimeClockAction(initialTimeClockActionState, clockForm()),
    ).resolves.toEqual({
      message: nlBE.timeClock.startSuccess,
      requestId,
      status: "success",
    });

    expect(mocks.getAuthContext).toHaveBeenCalledExactlyOnceWith(client);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("clock_in", {
      request_id: requestId,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/employee");
  });

  it("selects controlled clock-out RPC without forwarding authority fields", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          did_transition: true,
          request_id: requestId,
          result_code: "stopped",
        },
      ],
      error: null,
    });

    await expect(
      submitTimeClockAction(initialTimeClockActionState, clockForm("clock_out")),
    ).resolves.toEqual({
      message: nlBE.timeClock.stopSuccess,
      requestId,
      status: "success",
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("clock_out", {
      request_id: requestId,
    });
  });

  it.each([
    ["clock_in", "not-a-uuid"],
    ["delete", requestId],
    ["", requestId],
  ])(
    "rejects invalid operation/request pair before session access",
    async (operation, id) => {
      await expect(
        submitTimeClockAction(initialTimeClockActionState, clockForm(operation, id)),
      ).resolves.toEqual({ message: nlBE.timeClock.failure, status: "error" });
      expect(mocks.createServerClient).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it.each<AuthContext>([
    { state: "anonymous" },
    { state: "unauthorized", userId: "verified-user" },
    { state: "unsupported", userId: "verified-user" },
    { ...employee, role: "manager" },
  ])("rejects non-employee context $state before mutation", async (context) => {
    mocks.getAuthContext.mockResolvedValue(context);
    await expect(
      submitTimeClockAction(initialTimeClockActionState, clockForm()),
    ).resolves.toEqual({ message: nlBE.timeClock.failure, status: "error" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["clock_in", "already_working", nlBE.timeClock.alreadyWorking],
    ["clock_out", "already_stopped", nlBE.timeClock.alreadyStopped],
  ])(
    "accepts valid idempotent %s result %s",
    async (operation, resultCode, message) => {
      mocks.rpc.mockResolvedValue({
        data: [
          { did_transition: false, request_id: requestId, result_code: resultCode },
        ],
        error: null,
      });
      await expect(
        submitTimeClockAction(initialTimeClockActionState, clockForm(operation)),
      ).resolves.toEqual({ message, requestId, status: "success" });
      expect(mocks.revalidatePath).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["clock_in", "stopped", true],
    ["clock_in", "already_stopped", false],
    ["clock_out", "started", true],
    ["clock_out", "already_working", false],
    ["clock_in", "started", false],
    ["clock_in", "already_working", true],
    ["clock_out", "stopped", false],
    ["clock_out", "already_stopped", true],
  ])(
    "fails closed on invalid semantic result %s + %s + %s",
    async (operation, resultCode, didTransition) => {
      mocks.rpc.mockResolvedValue({
        data: [
          {
            did_transition: didTransition,
            request_id: requestId,
            result_code: resultCode,
          },
        ],
        error: null,
      });

      await expect(
        submitTimeClockAction(initialTimeClockActionState, clockForm(operation)),
      ).resolves.toEqual({ message: nlBE.timeClock.failure, status: "error" });
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it.each([
    { data: [], error: null },
    { data: null, error: null },
    {
      data: [{ did_transition: true, request_id: requestId, result_code: "unknown" }],
      error: null,
    },
    {
      data: [
        {
          did_transition: true,
          request_id: "20000000-0000-4000-8000-000000000001",
          result_code: "started",
        },
      ],
      error: null,
    },
    {
      data: [{ did_transition: "yes", request_id: requestId, result_code: "started" }],
      error: null,
    },
    {
      data: [{ did_transition: true, request_id: requestId, result_code: "started" }],
      error: { message: "private database detail" },
    },
  ])("fails closed on malformed or rejected RPC result %#", async (result) => {
    mocks.rpc.mockResolvedValue(result);
    await expect(
      submitTimeClockAction(initialTimeClockActionState, clockForm()),
    ).resolves.toEqual({ message: nlBE.timeClock.failure, status: "error" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each(["client", "context", "rpc"])(
    "hides private details when %s throws",
    async (stage) => {
      const error = new Error("private provider detail");
      if (stage === "client") mocks.createServerClient.mockRejectedValue(error);
      if (stage === "context") mocks.getAuthContext.mockRejectedValue(error);
      if (stage === "rpc") mocks.rpc.mockRejectedValue(error);

      await expect(
        submitTimeClockAction(initialTimeClockActionState, clockForm()),
      ).resolves.toEqual({ message: nlBE.timeClock.failure, status: "error" });
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    },
  );
});
