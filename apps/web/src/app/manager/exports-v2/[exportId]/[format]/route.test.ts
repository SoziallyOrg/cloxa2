import { beforeEach, expect, it, vi } from "vitest";
import { v2 as snapshot } from "@/lib/time-exports-v2/fixtures.test-data";

const mocks = vi.hoisted(() => ({ snapshot: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/time-exports-v2/server", () => ({ getV2Snapshot: mocks.snapshot }));
import { GET } from "@/app/manager/exports-v2/[exportId]/[format]/route";

const context = (exportId: string, format: string) => ({
  params: Promise.resolve({ exportId, format }),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.snapshot.mockResolvedValue(snapshot);
});

it.each([
  ["csv", "text/csv; charset=utf-8"],
  ["json", "application/json; charset=utf-8"],
])(
  "serves authenticated %s with safe download headers",
  async (format, contentType) => {
    const response = await GET(
      new Request("http://local.test"),
      context(snapshot.manifest.export_id, format),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(contentType);
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="cloxa-time-export-v2_[A-Za-z0-9_.-]+"$/u,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-cloxa-artifact-sha256")).toMatch(/^[0-9a-f]{64}$/u);
  },
);

it("returns byte-identical repeated downloads", async () => {
  const one = await GET(
    new Request("http://local.test"),
    context(snapshot.manifest.export_id, "json"),
  );
  const two = await GET(
    new Request("http://local.test"),
    context(snapshot.manifest.export_id, "json"),
  );
  expect(new Uint8Array(await one.arrayBuffer())).toEqual(
    new Uint8Array(await two.arrayBuffer()),
  );
});

it.each([
  ["not-a-uuid", "csv"],
  [snapshot.manifest.export_id, "xlsx"],
])("rejects invalid path %s/%s before data access", async (exportId, format) => {
  const response = await GET(
    new Request("http://local.test"),
    context(exportId, format),
  );
  expect(response.status).toBe(404);
  expect(mocks.snapshot).not.toHaveBeenCalled();
});

it("conceals denied or missing exports", async () => {
  mocks.snapshot.mockResolvedValue(null);
  const response = await GET(
    new Request("http://local.test"),
    context(snapshot.manifest.export_id, "csv"),
  );
  expect(response.status).toBe(404);
  expect(await response.text()).toBe("");
});

it.each(["csv", "json"])(
  "denies %s larger than 10 MiB without returning content",
  async (format) => {
    mocks.snapshot.mockResolvedValue({
      ...snapshot,
      records: [
        {
          ...snapshot.records[0],
          worksite_name: "é".repeat(6 * 1024 * 1024),
        },
      ],
    });
    const response = await GET(
      new Request("http://local.test"),
      context(snapshot.manifest.export_id, format),
    );
    expect(response.status).toBe(413);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  },
);
