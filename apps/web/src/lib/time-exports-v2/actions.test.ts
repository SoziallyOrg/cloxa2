import { beforeEach, expect, it, vi } from "vitest";
import { v2 } from "./fixtures.test-data";
const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  rpc: vi.fn(),
  auth: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("@/lib/auth/session", () => ({ getAuthContext: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import { exportV2Action } from "./actions";
const request = {
  request_id: v2.manifest.export_id,
  intent: "create",
  start: v2.manifest.period_start_local,
  end: v2.manifest.period_end_local,
  confirmed: true,
};
const result = {
  request_id: request.request_id,
  result_code: "created",
  did_create: true,
  manifest: v2.manifest,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue({ rpc: mocks.rpc });
  mocks.auth.mockResolvedValue({ state: "authorized", role: "manager" });
  mocks.rpc.mockResolvedValue({ data: result, error: null });
});
it("confirmed creation retires UUID and refreshes", async () => {
  expect((await exportV2Action(request)).requestId).toBe(request.request_id);
  expect(mocks.refresh).toHaveBeenCalledWith("/manager/exports-v2");
});
it.each([
  null,
  {},
  [],
  { ...result, request_id: "bad" },
  { ...result, did_create: false },
  { ...result, extra: 1 },
])("malformed outcome retains UUID %#", async (data) => {
  mocks.rpc.mockResolvedValue({ data, error: null });
  expect((await exportV2Action(request)).requestId).toBeUndefined();
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it("durable blocker completes operation", async () => {
  mocks.rpc.mockResolvedValue({
    data: {
      ...result,
      result_code: "pending_break_correction",
      did_create: false,
      manifest: null,
    },
    error: null,
  });
  expect((await exportV2Action(request)).requestId).toBe(request.request_id);
  expect(mocks.refresh).toHaveBeenCalled();
});
it("wrong role cannot create export", async () => {
  mocks.auth.mockResolvedValue({ state: "authorized", role: "employee" });
  await exportV2Action(request);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("contains network failure", async () => {
  mocks.rpc.mockRejectedValue(new Error("private secret"));
  const state = await exportV2Action(request);
  expect(state.requestId).toBeUndefined();
  expect(state.message).not.toContain("secret");
});
