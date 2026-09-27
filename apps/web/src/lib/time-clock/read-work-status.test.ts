import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), clock: vi.fn(), client: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getAuthContext: mocks.auth }));
vi.mock("@/lib/time-clock/server", () => ({ getEmployeeTimeClock: mocks.clock }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
import { readWorkStatus } from "./read-work-status";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue({});
  mocks.auth.mockResolvedValue({
    state: "authorized",
    role: "employee",
    userId: "synthetic",
    organizationId: "org",
  });
  mocks.clock.mockResolvedValue({
    status: "on_break",
    currentStartedAt: "2026-09-07T07:00:00Z",
    serverTime: "2026-09-07T08:00:00Z",
    entries: ["not sent"],
  });
});
it("returns only clock summary using the same verified client", async () => {
  expect(await readWorkStatus("synthetic:org")).toEqual({
    status: "on_break",
    currentStartedAt: "2026-09-07T07:00:00Z",
    serverTime: "2026-09-07T08:00:00Z",
  });
  expect(mocks.clock).toHaveBeenCalledWith(await mocks.client.mock.results[0]?.value);
});
it.each([
  { state: "anonymous" },
  { state: "authorized", role: "manager", userId: "synthetic", organizationId: "org" },
  { state: "authorized", role: "employee", userId: "another", organizationId: "org" },
  {
    state: "authorized",
    role: "employee",
    userId: "synthetic",
    organizationId: "other-org",
  },
])("refuses logout/account/role/scope change %#", async (auth) => {
  mocks.auth.mockResolvedValue(auth);
  expect(await readWorkStatus("synthetic:org")).toBeNull();
  expect(mocks.clock).not.toHaveBeenCalled();
});
it("returns unknown on read failure rather than stopped", async () => {
  mocks.clock.mockRejectedValue(new Error("unavailable"));
  expect(await readWorkStatus("synthetic:org")).toBeNull();
});
