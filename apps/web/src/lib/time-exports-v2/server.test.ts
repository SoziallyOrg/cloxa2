import { beforeEach, expect, it, vi } from "vitest";
import { v2 } from "./fixtures.test-data";
const mocks = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
import { getV2Snapshot, getV2History } from "./server";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue({ rpc: mocks.rpc });
});
it("downloads through current session RPC and verifies dataset hash", async () => {
  mocks.rpc.mockImplementation(async (_name: string, args: { request_id: string }) => ({
    data: { ...v2, request_id: args.request_id },
    error: null,
  }));
  expect(await getV2Snapshot(v2.manifest.export_id)).toEqual(v2);
  expect(mocks.rpc.mock.calls[0]?.[0]).toBe("get_time_export_v2_snapshot");
});
it.each(["hash", "uuid", "cross-tenant", "provider"])(
  "denies %s failure",
  async (failure) => {
    mocks.rpc.mockImplementation(
      async (_name: string, args: { request_id: string }) => ({
        data: {
          ...v2,
          request_id: failure === "uuid" ? v2.manifest.worksite_id : args.request_id,
          manifest: {
            ...v2.manifest,
            dataset_sha256:
              failure === "hash" ? "a".repeat(64) : v2.manifest.dataset_sha256,
          },
        },
        error:
          failure === "provider" || failure === "cross-tenant"
            ? { message: "private detail" }
            : null,
      }),
    );
    expect(await getV2Snapshot(v2.manifest.export_id)).toBeNull();
  },
);
it("history validates request correlation", async () => {
  mocks.rpc.mockImplementation(async (_name: string, args: { request_id: string }) => ({
    data: { request_id: args.request_id, exports: [v2.manifest] },
    error: null,
  }));
  expect(await getV2History()).toEqual([v2.manifest]);
});
