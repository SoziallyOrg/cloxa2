import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createServerClient,
}));

import { getEmployeeCorrectionRequests } from "@/lib/corrections/server";

const data = {
  entries: [],
  requests: [],
  server_time: "2026-08-12T08:00:00Z",
  timezone: "Europe/Brussels",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createServerClient.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data, error: null });
});

describe("employee correction reader", () => {
  it("loads through no-argument controlled RPC", async () => {
    await expect(getEmployeeCorrectionRequests()).resolves.toEqual({
      entries: [],
      requests: [],
      serverTime: data.server_time,
      timezone: "Europe/Brussels",
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "get_employee_correction_requests",
    );
  });

  it.each([
    { data: null, error: null },
    { data, error: { message: "private database detail" } },
  ])("returns unavailable state for provider result %#", async (result) => {
    mocks.rpc.mockResolvedValue(result);
    await expect(getEmployeeCorrectionRequests()).resolves.toBeNull();
  });

  it("contains provider exceptions", async () => {
    mocks.rpc.mockRejectedValue(new Error("private provider detail"));
    await expect(getEmployeeCorrectionRequests()).resolves.toBeNull();
  });
});
