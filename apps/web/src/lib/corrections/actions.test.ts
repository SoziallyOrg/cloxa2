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

import {
  submitCorrectionRequestAction,
  withdrawCorrectionRequestAction,
} from "@/lib/corrections/actions";
import {
  initialCorrectionActionState,
  initialWithdrawalActionState,
} from "@/lib/corrections/model";

const requestId = "10000000-0000-4000-8000-000000000001";
const targetId = "20000000-0000-4000-8000-000000000001";
const correctionId = "30000000-0000-4000-8000-000000000001";
const client = { rpc: mocks.rpc };
const employee: AuthContext = {
  organizationId: "organization-one",
  role: "employee",
  state: "authorized",
  userId: "verified-user",
};

function submissionForm(overrides: Record<string, string> = {}) {
  const fields = {
    employee_reason: "Starttijd was verkeerd.",
    proposed_end_local: "10/08/2026 12:00",
    proposed_end_occurrence: "",
    proposed_start_local: "10/08/2026 10:15",
    proposed_start_occurrence: "",
    request_id: requestId,
    request_kind: "adjustment",
    target_time_entry_id: targetId,
    ...overrides,
  };
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  form.set("organization_id", "forged-organization");
  form.set("membership_id", "forged-membership");
  form.set("role", "manager");
  form.set("status", "approved");
  form.set("actor_user_id", "forged-user");
  form.set("audit_action", "forged-audit");
  return form;
}

function withdrawalForm(id = requestId, target = correctionId) {
  const form = new FormData();
  form.set("request_id", id);
  form.set("correction_request_id", target);
  form.set("organization_id", "forged-organization");
  form.set("membership_id", "forged-membership");
  form.set("status", "withdrawn");
  return form;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createServerClient.mockResolvedValue(client);
  mocks.getAuthContext.mockResolvedValue(employee);
  mocks.rpc.mockResolvedValue({
    data: [
      {
        correction_request_id: correctionId,
        did_create: true,
        request_id: requestId,
        request_status: "pending",
        result_code: "submitted",
      },
    ],
    error: null,
  });
});

describe("employee correction submission action", () => {
  it("forwards exact endpoint microseconds without browser timezone interpretation", async () => {
    await submitCorrectionRequestAction(
      initialCorrectionActionState,
      submissionForm({
        proposed_end_local: "10/08/2026 12:00:01.123456",
      }),
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "submit_employee_correction_request",
      expect.objectContaining({ proposed_end_local: "2026-08-10T12:00:01.123456" }),
    );
  });
  it("associates ambiguity with named endpoint selector only", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "correction_ambiguous_local_time",
        details: "proposed_start_local",
      },
    });
    const result = await submitCorrectionRequestAction(
      initialCorrectionActionState,
      submissionForm(),
    );
    expect(result.fieldErrors).toEqual({
      proposed_start_occurrence: nlBE.corrections.validation.ambiguousTime,
    });
  });
  it.each([null, [], [{}], [{ request_id: requestId, did_create: false }]])(
    "rejects malformed result %#",
    async (data) => {
      mocks.rpc.mockResolvedValue({ data, error: null });
      await expect(
        submitCorrectionRequestAction(initialCorrectionActionState, submissionForm()),
      ).resolves.toMatchObject({ status: "error" });
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    },
  );
  it("hides unexpected provider exceptions", async () => {
    mocks.rpc.mockRejectedValue(new Error("sensitive provider context"));
    await expect(
      submitCorrectionRequestAction(initialCorrectionActionState, submissionForm()),
    ).resolves.toEqual({ message: nlBE.corrections.failure, status: "error" });
  });
  it("forwards claims but no tenant, identity, role, status, or audit authority", async () => {
    await expect(
      submitCorrectionRequestAction(initialCorrectionActionState, submissionForm()),
    ).resolves.toEqual({
      message: nlBE.corrections.submissionSuccess,
      requestId,
      status: "success",
    });

    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "submit_employee_correction_request",
      {
        employee_reason: "Starttijd was verkeerd.",
        proposed_end_local: "2026-08-10T12:00",
        proposed_end_occurrence: "",
        proposed_start_local: "2026-08-10T10:15",
        proposed_start_occurrence: "",
        request_id: requestId,
        request_kind: "adjustment",
        target_time_entry_id: targetId,
      },
    );
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith(
      "/employee/corrections",
    );
  });

  it("forwards explicit autumn occurrence choices unchanged", async () => {
    await submitCorrectionRequestAction(
      initialCorrectionActionState,
      submissionForm({
        proposed_end_occurrence: "later",
        proposed_start_occurrence: "earlier",
      }),
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "submit_employee_correction_request",
      expect.objectContaining({
        proposed_end_occurrence: "later",
        proposed_start_occurrence: "earlier",
      }),
    );
  });

  it("sends null target only for missed-entry request", async () => {
    await submitCorrectionRequestAction(
      initialCorrectionActionState,
      submissionForm({ request_kind: "missed_entry", target_time_entry_id: "" }),
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "submit_employee_correction_request",
      expect.objectContaining({
        request_kind: "missed_entry",
        target_time_entry_id: "",
      }),
    );
  });

  it.each([
    { request_id: "bad" },
    { request_kind: "approve" },
    { employee_reason: " " },
    { employee_reason: "x".repeat(501) },
    { proposed_start_local: "10/08/2026 10:15Z" },
    { proposed_end_occurrence: "guess" },
    { target_time_entry_id: "" },
    { request_kind: "missed_entry", target_time_entry_id: targetId },
  ])("rejects malformed employee input before session access %#", async (override) => {
    await expect(
      submitCorrectionRequestAction(
        initialCorrectionActionState,
        submissionForm(override),
      ),
    ).resolves.toMatchObject({ status: "error" });
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each<AuthContext>([
    { state: "anonymous" },
    { state: "unauthorized", userId: "verified-user" },
    { state: "unsupported", userId: "verified-user" },
    { ...employee, role: "manager" },
  ])("rejects non-employee context $state", async (context) => {
    mocks.getAuthContext.mockResolvedValue(context);
    await expect(
      submitCorrectionRequestAction(initialCorrectionActionState, submissionForm()),
    ).resolves.toEqual({
      message: nlBE.corrections.failure,
      status: "error",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["correction_nonexistent_local_time", nlBE.corrections.validation.nonexistentTime],
    ["correction_ambiguous_local_time", nlBE.corrections.validation.ambiguousTime],
    ["correction_interval_not_past", nlBE.corrections.validation.past],
    ["correction_invalid_interval", nlBE.corrections.validation.interval],
    ["correction_unchanged", nlBE.corrections.validation.unchanged],
    ["correction_factual_overlap", nlBE.corrections.validation.factualOverlap],
    ["correction_pending_conflict", nlBE.corrections.validation.pendingConflict],
  ])("maps controlled database validation %s", async (databaseMessage, message) => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: databaseMessage },
    });
    await expect(
      submitCorrectionRequestAction(initialCorrectionActionState, submissionForm()),
    ).resolves.toMatchObject({ message, status: "error" });
  });

  it.each(["private database detail", "correction_request_id_reused"])(
    "does not expose database detail %s",
    async (databaseMessage) => {
      mocks.rpc.mockResolvedValue({
        data: null,
        error: { message: databaseMessage },
      });
      const result = await submitCorrectionRequestAction(
        initialCorrectionActionState,
        submissionForm(),
      );
      expect(result.message).not.toContain(databaseMessage);
      expect(result.status).toBe("error");
    },
  );
});

describe("employee correction withdrawal action", () => {
  it("rejects response mismatch and hides thrown failures", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ request_id: requestId, correction_request_id: targetId }],
      error: null,
    });
    await expect(
      withdrawCorrectionRequestAction(initialWithdrawalActionState, withdrawalForm()),
    ).resolves.toMatchObject({ status: "error" });
    mocks.rpc.mockRejectedValue(new Error("sensitive provider context"));
    await expect(
      withdrawCorrectionRequestAction(initialWithdrawalActionState, withdrawalForm()),
    ).resolves.toEqual({ message: nlBE.corrections.withdrawFailure, status: "error" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          correction_request_id: correctionId,
          did_withdraw: true,
          request_id: requestId,
          request_status: "withdrawn",
          result_code: "withdrawn",
        },
      ],
      error: null,
    });
  });

  it("forwards only operation request and correction request IDs", async () => {
    await expect(
      withdrawCorrectionRequestAction(initialWithdrawalActionState, withdrawalForm()),
    ).resolves.toEqual({
      message: nlBE.corrections.withdrawSuccess,
      requestId,
      status: "success",
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "withdraw_employee_correction_request",
      { correction_request_id: correctionId, request_id: requestId },
    );
  });

  it("accepts idempotent already-withdrawn result without extra authority", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          correction_request_id: correctionId,
          did_withdraw: false,
          request_id: requestId,
          request_status: "withdrawn",
          result_code: "already_withdrawn",
        },
      ],
      error: null,
    });
    await expect(
      withdrawCorrectionRequestAction(initialWithdrawalActionState, withdrawalForm()),
    ).resolves.toMatchObject({
      message: nlBE.corrections.alreadyWithdrawn,
      status: "success",
    });
  });

  it.each([
    ["bad", correctionId],
    [requestId, "bad"],
  ])("rejects malformed IDs before session access", async (id, target) => {
    await expect(
      withdrawCorrectionRequestAction(
        initialWithdrawalActionState,
        withdrawalForm(id, target),
      ),
    ).resolves.toEqual({
      message: nlBE.corrections.withdrawFailure,
      status: "error",
    });
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("hides provider and authorization detail", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "private database detail" },
    });
    await expect(
      withdrawCorrectionRequestAction(initialWithdrawalActionState, withdrawalForm()),
    ).resolves.toEqual({
      message: nlBE.corrections.withdrawFailure,
      status: "error",
    });
  });
});
