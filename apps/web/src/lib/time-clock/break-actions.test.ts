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
const started = {
  request_id: id,
  result_code: "started",
  did_transition: true,
  break_id: "10000000-0000-4000-8000-000000000002",
  time_entry_id: "10000000-0000-4000-8000-000000000003",
  started_at: "2026-09-04T10:00:00.123456Z",
  ended_at: null,
  version: 1,
};
const ended = {
  ...started,
  result_code: "ended",
  ended_at: "2026-09-04T10:00:00.123457Z",
  version: 2,
};
const empty = {
  ...started,
  did_transition: false,
  break_id: null,
  started_at: null,
  ended_at: null,
  version: null,
};
const initial = { status: "idle" as const, message: "" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue({ rpc: mocks.rpc });
  mocks.context.mockResolvedValue({ state: "authorized", role: "employee" });
  mocks.rpc.mockResolvedValue({
    data: started,
    error: null,
  });
});
describe("break actions", () => {
  it.each([
    ["start_break", { ...empty, result_code: "no_open_shift", time_entry_id: null }],
    ["end_break", { ...empty, result_code: "no_open_shift", time_entry_id: null }],
    [
      "start_break",
      { ...started, result_code: "already_on_break", did_transition: false },
    ],
    ["end_break", { ...empty, result_code: "no_open_break" }],
    ["start_break", { ...empty, result_code: "invalid_interval" }],
    [
      "end_break",
      { ...started, result_code: "invalid_interval", did_transition: false },
    ],
  ])("completes safe %s blocker %# and refreshes state", async (operation, data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    const state = await submitBreakAction(initial, form(operation));
    expect(state.requestId).toBe(id);
    expect(state.status).toBe("error");
    expect(state.message).toBeTruthy();
    expect(mocks.revalidate).toHaveBeenCalledExactlyOnceWith("/employee");
  });
  const malformed = [
    null,
    [],
    {},
    { result_code: "started", did_transition: true },
    { ...started, request_id: "10000000-0000-4000-8000-000000000004" },
    { ...started, secret: "provider detail" },
    { ...started, break_id: "bad" },
    { ...started, time_entry_id: "bad" },
    { ...started, started_at: "yesterday" },
    { ...started, started_at: "2026-02-30T10:00:00Z" },
    { ...started, started_at: "prefix2026-09-04T10:00:00Z" },
    { ...started, started_at: "2026-09-04T24:00:00Z" },
    { ...started, started_at: "2026-09-04T10:00:00.1234567Z" },
    { ...started, version: 2 },
    { ...started, version: "1" },
    { ...started, ended_at: ended.ended_at },
    { ...started, did_transition: false },
    { ...started, did_transition: "true" },
    { ...started, result_code: "unknown" },
    { ...started, result_code: "no_open_break", did_transition: false },
    { ...started, result_code: "no_open_shift", did_transition: false },
    { ...started, result_code: "invalid_interval", did_transition: false },
    { ...started, result_code: "already_on_break", did_transition: true },
    Object.fromEntries(Object.entries(started).filter(([key]) => key !== "ended_at")),
  ];
  it.each(malformed)(
    "rejects malformed start response %# without completing UUID",
    async (data) => {
      mocks.rpc.mockResolvedValue({ data, error: null });
      expect(
        await submitBreakAction(
          { status: "success", message: "previous", requestId: id },
          form(),
        ),
      ).toEqual({ status: "error", message: nlBE.breaks.failure });
      expect(mocks.revalidate).not.toHaveBeenCalled();
    },
  );
  it.each([
    started,
    { ...ended, ended_at: null },
    { ...ended, ended_at: started.started_at },
    { ...ended, ended_at: "2026-09-04T10:00:00.123455Z" },
    { ...ended, ended_at: "2026-09-04T10:00:00" },
    { ...ended, version: 1 },
    { ...ended, did_transition: false },
    { ...started, result_code: "already_on_break", did_transition: false },
    { ...empty, result_code: "no_open_break", time_entry_id: null },
    { ...empty, result_code: "invalid_interval" },
  ])("rejects contradictory end response %#", async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    expect(
      (await submitBreakAction(initial, form("end_break"))).requestId,
    ).toBeUndefined();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("rejects ended result for start operation", async () => {
    mocks.rpc.mockResolvedValue({ data: ended, error: null });
    expect((await submitBreakAction(initial, form())).requestId).toBeUndefined();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("provider error leaves UUID uncertain even with valid-looking data", async () => {
    mocks.rpc.mockResolvedValue({
      data: started,
      error: { message: "private provider detail" },
    });
    expect(await submitBreakAction(initial, form())).toEqual({
      status: "error",
      message: nlBE.breaks.failure,
    });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

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
      data: result === "started" ? started : ended,
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
