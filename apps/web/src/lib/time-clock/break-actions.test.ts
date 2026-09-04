import { beforeEach, describe, expect, it, vi } from "vitest";
import { nlBE } from "@/i18n/nl-BE";
const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  context: vi.fn(),
  rpc: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("@/lib/auth/session", () => ({ getAuthContext: mocks.context }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { submitBreakAction } from "./break-actions";
const id = "10000000-0000-4000-8000-000000000001";
function form(operation = "start_break") {
  const data = new FormData();
  data.set("operation", operation);
  data.set("request_id", id);
  return data;
}
const initial = { status: "idle" as const, message: "" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue({ rpc: mocks.rpc });
  mocks.context.mockResolvedValue({ state: "authorized", role: "employee" });
  mocks.rpc.mockResolvedValue({
    data: { result_code: "started", did_transition: true },
    error: null,
  });
});
describe("break actions", () => {
  it("ignores framework metadata from reloaded forms without forwarding it", async () => {
    const data = form();
    data.set("$ACTION_REF_3", "");
    data.set("$ACTION_3:0", "framework-only");
    data.set("$ACTION_KEY", "framework-only");
    expect((await submitBreakAction(initial, data)).status).toBe("success");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("start_break", {
      request_id: id,
    });
  });
  it.each([
    ["start_break", "started"],
    ["end_break", "ended"],
  ])("sends only UUID for %s", async (operation, result) => {
    mocks.rpc.mockResolvedValue({
      data: { result_code: result, did_transition: true },
      error: null,
    });
    expect((await submitBreakAction(initial, form(operation))).status).toBe("success");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(operation, { request_id: id });
  });
  it.each([
    "started_at",
    "ended_at",
    "employee_membership_id",
    "organization_id",
    "worksite_id",
    "time_entry_id",
  ])("rejects supplied %s", async (field) => {
    const data = form();
    data.set(field, id);
    expect((await submitBreakAction(initial, data)).status).toBe("error");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects duplicate payload fields", async () => {
    const data = form();
    data.append("request_id", id);
    expect((await submitBreakAction(initial, data)).status).toBe("error");
  });
  it.each(["manager", "inactive"])("denies %s", async (role) => {
    mocks.context.mockResolvedValue({ state: "authorized", role });
    expect((await submitBreakAction(initial, form())).status).toBe("error");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("contains provider details and preserves retry UUID on failure", async () => {
    mocks.rpc.mockRejectedValue(new Error("private credential session detail"));
    expect(await submitBreakAction(initial, form())).toEqual({
      status: "error",
      message: nlBE.breaks.failure,
    });
  });
});
