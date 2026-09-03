import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createServerClient,
}));

import { getEmployeeTimeClock } from "@/lib/time-clock/server";

const data = {
  current_started_at: null,
  entries: [],
  server_time: "2026-09-02T08:00:00Z",
  status: "not_working",
  timezone: "Europe/Brussels",
  worksite_id: "20000000-0000-4000-8000-000000000001",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createServerClient.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data, error: null });
});

describe("employee time-clock reader", () => {
  it("loads state through the no-argument trusted RPC", async () => {
    await expect(getEmployeeTimeClock()).resolves.toMatchObject({
      entries: [],
      status: "not_working",
      timezone: "Europe/Brussels",
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("get_employee_time_clock");
  });

  it.each([
    { data: null, error: null },
    { data, error: { message: "private database detail" } },
  ])("returns unavailable state for malformed/provider result %#", async (result) => {
    mocks.rpc.mockResolvedValue(result);
    await expect(getEmployeeTimeClock()).resolves.toBeNull();
  });

  it("contains provider exceptions", async () => {
    mocks.rpc.mockRejectedValue(new Error("private provider detail"));
    await expect(getEmployeeTimeClock()).resolves.toBeNull();
  });
});
