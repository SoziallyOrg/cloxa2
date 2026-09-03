import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
import { getManagerCorrectionRequests } from "@/lib/manager-corrections/server";
const data = {
  requests: [],
  pending_count: 0,
  timezone: "Europe/Brussels",
  server_time: "2010-01-01T10:00:00Z",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data, error: null });
});
it("loads manager queue only through no-argument RPC", async () => {
  expect(await getManagerCorrectionRequests()).toEqual({
    requests: [],
    pendingCount: 0,
  });
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("get_manager_correction_requests");
});
it.each([
  { data: null, error: null },
  { data: {}, error: null },
  { data, error: { message: "private detail" } },
])("contains invalid provider result %#", async (result) => {
  mocks.rpc.mockResolvedValue(result);
  expect(await getManagerCorrectionRequests()).toBeNull();
});
it("contains provider exceptions", async () => {
  mocks.rpc.mockRejectedValue(new Error("private detail"));
  expect(await getManagerCorrectionRequests()).toBeNull();
});
