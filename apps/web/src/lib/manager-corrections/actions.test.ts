import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  auth: vi.fn(),
  rpc: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("@/lib/auth/session", () => ({ getAuthContext: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { decideCorrectionRequestAction } from "@/lib/manager-corrections/actions";
import { nlBE } from "@/i18n/nl-BE";

const requestId = "10000000-0000-4000-8000-000000000001";
const correctionId = "20000000-0000-4000-8000-000000000001";
const entryId = "30000000-0000-4000-8000-000000000001";
const validResult = {
  request_id: requestId,
  correction_request_id: correctionId,
  result_code: "approved",
  request_status: "approved",
  did_decide: true,
  time_entry_id: entryId,
};
function form(fields: Record<string, string> = {}) {
  const result = new FormData();
  for (const [key, value] of Object.entries({
    request_id: requestId,
    correction_request_id: correctionId,
    decision: "approve",
    manager_note: "",
    ...fields,
  }))
    result.set(key, value);
  return result;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue({ rpc: mocks.rpc });
  mocks.auth.mockResolvedValue({ state: "authorized", role: "manager" });
  mocks.rpc.mockResolvedValue({ data: [validResult], error: null });
});
describe("manager decision server action", () => {
  it("sends exactly four fields and refreshes both factual employee readers", async () => {
    expect((await decideCorrectionRequestAction(form())).status).toBe("success");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("decide_correction_request", {
      request_id: requestId,
      correction_request_id: correctionId,
      decision: "approve",
      manager_note: "",
    });
    expect(mocks.revalidate.mock.calls).toEqual([
      ["/manager/corrections"],
      ["/employee/corrections"],
      ["/employee"],
    ]);
  });
  it("rejects with exact note text for stable payload hashing", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...validResult,
          result_code: "rejected",
          request_status: "rejected",
          time_entry_id: null,
        },
      ],
      error: null,
    });
    expect(
      (
        await decideCorrectionRequestAction(
          form({ decision: "reject", manager_note: "  <b>Explanation</b>  " }),
        )
      ).status,
    ).toBe("success");
    expect(mocks.rpc.mock.calls[0]?.[1]?.manager_note).toBe("  <b>Explanation</b>  ");
  });
  it.each([
    "organization_id",
    "employee_membership_id",
    "role",
    "status",
    "actor_user_id",
    "proposed_started_at",
  ])("rejects browser authority field %s", async (field) => {
    expect(
      (await decideCorrectionRequestAction(form({ [field]: "forged" }))).status,
    ).toBe("error");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects duplicate form fields", async () => {
    const input = form();
    input.append("decision", "reject");
    expect((await decideCorrectionRequestAction(input)).status).toBe("error");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    { request_id: "bad" },
    { correction_request_id: "" },
    { decision: "edit" },
    { decision: "reject", manager_note: " \n " },
    { manager_note: "x".repeat(501) },
  ])("rejects invalid input %#", async (fields) => {
    expect((await decideCorrectionRequestAction(form(fields))).status).toBe("error");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    { state: "anonymous" },
    { state: "unauthorized" },
    { state: "unsupported" },
    { state: "authorized", role: "employee" },
  ])("fails closed for authorization %#", async (context) => {
    mocks.auth.mockResolvedValue(context);
    expect((await decideCorrectionRequestAction(form())).status).toBe("error");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    ["stale_request", "pending", nlBE.managerCorrections.stale],
    ["overlap", "pending", nlBE.managerCorrections.overlap],
    ["invalid_interval", "pending", nlBE.managerCorrections.invalidInterval],
    ["unavailable", "pending", nlBE.managerCorrections.unavailable],
    ["already_decided", "withdrawn", nlBE.managerCorrections.alreadyDecided],
    ["already_decided", "approved", nlBE.managerCorrections.alreadyDecided],
    ["already_decided", "rejected", nlBE.managerCorrections.alreadyDecided],
  ])("maps safe result %s/%s", async (code, status, message) => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...validResult,
          result_code: code,
          request_status: status,
          did_decide: false,
          time_entry_id: null,
        },
      ],
      error: null,
    });
    expect(await decideCorrectionRequestAction(form())).toEqual({
      status: "error",
      message,
    });
  });
  it.each([
    null,
    [],
    [validResult, validResult],
    ...[
      { request_id: "different" },
      { correction_request_id: "different" },
      { result_code: "unknown" },
      { request_status: "rejected" },
      { did_decide: false },
      { time_entry_id: null },
    ].map((fields) => [{ ...validResult, ...fields }]),
  ])("rejects inconsistent provider result %#", async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    expect((await decideCorrectionRequestAction(form())).status).toBe("error");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("contains provider messages and throws", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "private note secret" },
    });
    expect(await decideCorrectionRequestAction(form())).toEqual({
      status: "error",
      message: nlBE.managerCorrections.failure,
    });
    mocks.rpc.mockRejectedValue(new Error("private provider detail"));
    expect(await decideCorrectionRequestAction(form())).toEqual({
      status: "error",
      message: nlBE.managerCorrections.failure,
    });
  });
});
