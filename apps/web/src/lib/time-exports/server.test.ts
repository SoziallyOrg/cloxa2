import { beforeEach, expect, it, vi } from "vitest";
import { snapshot, snapshotWire } from "@/lib/time-exports/fixtures.test-data";
import { computeDatasetSha256 } from "@/lib/time-exports/serializer";

const mocks = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
import {
  getManagerTimeExports,
  getTimeExportSnapshot,
} from "@/lib/time-exports/server";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue({ rpc: mocks.rpc });
});

it("loads history through no-argument manager RPC", async () => {
  mocks.rpc.mockResolvedValue({
    data: { exports: [snapshotWire.manifest] },
    error: null,
  });
  expect(await getManagerTimeExports()).toHaveLength(1);
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("get_manager_time_exports");
});

it("loads one snapshot through UUID-only RPC", async () => {
  mocks.rpc.mockResolvedValue({
    data: {
      ...snapshotWire,
      manifest: {
        ...snapshotWire.manifest,
        dataset_sha256: computeDatasetSha256(snapshot),
      },
    },
    error: null,
  });
  expect(await getTimeExportSnapshot(snapshotWire.manifest.export_id)).not.toBeNull();
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("get_time_export_snapshot", {
    export_id: snapshotWire.manifest.export_id,
  });
});

it.each([
  { data: snapshotWire, error: null },
  { data: null, error: null },
  { data: snapshotWire, error: { message: "private provider detail" } },
])("contains provider failure %#", async (result) => {
  mocks.rpc.mockResolvedValue(result);
  expect(await getTimeExportSnapshot(snapshotWire.manifest.export_id)).toBeNull();
});
