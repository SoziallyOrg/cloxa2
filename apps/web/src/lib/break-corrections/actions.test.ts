import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  rpc: vi.fn(),
  auth: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("@/lib/auth/session", () => ({ getAuthContext: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import { changeBreakCorrection } from "./actions";
const id = "10000000-0000-4000-8000-000000000001";
const payload = {
  request_id: id,
  intent: "missed_break",
  entry_id: id,
  target_id: null,
  expected_parent_version: 2,
  expected_break_version: null,
  start_local: "31/10/2010 02:30:00.123456",
  start_occurrence: "earlier",
  end_local: "31/10/2010 02:45:00.123457",
  end_occurrence: "later",
  reason: "Fictief",
  confirmed: false,
};
const response = {
  request_id: id,
  result_code: "submitted",
  did_transition: true,
  correction_request_id: id,
  request_status: "pending",
  applied_revision_id: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ state: "authorized", role: "employee" });
  mocks.client.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: response, error: null });
});
it("preserves Brussels claims and microseconds; retires confirmed UUID and refreshes", async () => {
  expect((await changeBreakCorrection(payload)).requestId).toBe(id);
  expect(mocks.rpc.mock.calls[0]?.[1]).toMatchObject({
    start_local: "2010-10-31T02:30:00.123456",
    start_occurrence: "earlier",
    end_occurrence: "later",
  });
  expect(mocks.refresh).toHaveBeenCalled();
});
it.each([
  null,
  {},
  [],
  { ...response, extra: true },
  { ...response, request_id: "bad" },
])("uncertain malformed result preserves UUID %#", async (data) => {
  mocks.rpc.mockResolvedValue({ data, error: null });
  expect((await changeBreakCorrection(payload)).requestId).toBeUndefined();
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it("handles transport error without provider text", async () => {
  mocks.rpc.mockRejectedValue(new Error("private provider secret"));
  const state = await changeBreakCorrection(payload);
  expect(state.requestId).toBeUndefined();
  expect(state.message).not.toContain("secret");
});
it.each(["correction_nonexistent_local_time", "correction_ambiguous_local_time"])(
  "Dutch conversion error %s",
  async (message) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message } });
    const state = await changeBreakCorrection(payload);
    expect(state.message).not.toContain("correction_");
    expect(state.requestId).toBeUndefined();
  },
);
it("denies wrong role before RPC", async () => {
  mocks.auth.mockResolvedValue({ state: "authorized", role: "manager" });
  await changeBreakCorrection(payload);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("manager confirms rejection with note", async () => {
  mocks.auth.mockResolvedValue({ state: "authorized", role: "manager" });
  mocks.rpc.mockResolvedValue({
    data: { ...response, result_code: "rejected", request_status: "rejected" },
    error: null,
  });
  const state = await changeBreakCorrection({
    ...payload,
    intent: "reject",
    target_id: id,
    confirmed: true,
  });
  expect(state.requestId).toBe(id);
  expect(mocks.rpc.mock.calls[0]?.[0]).toBe("decide_break_correction");
});
