import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorkspaceClock,
  CLOCK_FRESH_MS,
  CLOCK_READ_MS,
  type WorkSnapshot,
} from "./workspace-clock";
import type { TimeClockActionState } from "./model";
const snapshot = (
  status: WorkSnapshot["status"] = "working",
  second = 0,
): WorkSnapshot => ({
  status,
  currentStartedAt: status === "not_working" ? null : "2026-09-07T07:00:00Z",
  serverTime: new Date(Date.UTC(2026, 8, 7, 8, 0, second)).toISOString(),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { resolve, reject, promise };
}
let stores: WorkspaceClock[];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  stores = [];
});
afterEach(() => {
  stores.forEach((s) => s.stop());
  vi.useRealTimers();
});
function setup() {
  const read = vi
    .fn<(_: string) => Promise<WorkSnapshot | null>>()
    .mockResolvedValue(snapshot());
  const submit =
    vi.fn<
      (
        _: TimeClockActionState,
        form: FormData,
        scope: string,
      ) => Promise<TimeClockActionState>
    >();
  let id = 0;
  const clock = new WorkspaceClock("a:org", { read, submit, uuid: () => `id-${++id}` });
  stores.push(clock);
  clock.start();
  return { clock, read, submit };
}
describe("persistent scoped clock coordinator", () => {
  it("presentation ownership and one-time receipt do not change the mutation lock", async () => {
    const { clock, read, submit } = setup();
    await clock.refresh();
    const action = deferred<TimeClockActionState>();
    submit.mockReturnValue(action.promise);
    const pending = clock.submit("start_break", "panel");
    expect(clock.getSnapshot()).toMatchObject({
      pendingIntent: "start_break",
      feedbackOwner: "panel",
    });
    expect(await clock.submit("clock_out", "header")).toBe(false);
    read.mockResolvedValue(snapshot("on_break", 1));
    action.resolve({ status: "success", message: "done", requestId: "id-1" });
    await pending;
    const version = clock.getSnapshot().feedbackVersion;
    expect(clock.markFeedbackPresented(version)).toBe(true);
    expect(clock.markFeedbackPresented(version)).toBe(false);
    expect(clock.getSnapshot().pendingIntent).toBeNull();
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it("a frozen server timestamp cannot extend confirmation forever", async () => {
    const { clock } = setup();
    await clock.refresh();
    await vi.advanceTimersByTimeAsync(20_000);
    await clock.refresh(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(clock.getSnapshot().phase).toBe("unavailable");
    expect(clock.canSubmit("clock_out")).toBe(false);
  });
  it("same-account navigation retains confirmed state and deduplicates quiet refreshes", async () => {
    const { clock, read } = setup();
    await clock.refresh();
    const confirmed = clock.getSnapshot().clock;
    await clock.refresh();
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6000);
    const pending = deferred<WorkSnapshot | null>();
    read.mockReturnValue(pending.promise);
    const a = clock.refresh(),
      b = clock.refresh(true);
    expect(a).toBe(b);
    expect(clock.getSnapshot().phase).toBe("confirmed");
    expect(clock.getSnapshot().clock).toBe(confirmed);
    pending.resolve(snapshot());
    await a;
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("failure disables controls, never labels unavailable as stopped", async () => {
    const { clock, read } = setup();
    await clock.refresh();
    read.mockRejectedValue(new Error("offline"));
    await clock.refresh(true);
    expect(clock.getSnapshot()).toMatchObject({ clock: null, phase: "unavailable" });
    expect(clock.canSubmit("clock_out")).toBe(false);
  });
  it("expires at 30 seconds even when a quiet refresh is stalled", async () => {
    const { clock, read } = setup();
    await clock.refresh();
    await vi.advanceTimersByTimeAsync(CLOCK_FRESH_MS - 1000);
    read.mockReturnValue(new Promise(() => {}));
    void clock.refresh(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(clock.getSnapshot().clock).toBeNull();
    expect(clock.canSubmit("clock_out")).toBe(false);
  });
  it("deadline rejects a late response and permits a newer independent read", async () => {
    const { clock, read } = setup();
    await clock.refresh();
    const old = deferred<WorkSnapshot | null>();
    read.mockReturnValueOnce(old.promise);
    void clock.refresh(true);
    await vi.advanceTimersByTimeAsync(CLOCK_READ_MS);
    expect(clock.getSnapshot().phase).toBe("unavailable");
    read.mockResolvedValue(snapshot("on_break", 2));
    await clock.refresh(true);
    old.resolve(snapshot("working", 1));
    await Promise.resolve();
    expect(clock.getSnapshot().clock?.status).toBe("on_break");
  });
  it.each(["b:org", "a:other-org"])(
    "clears immediately for %s and rejects late old-scope reads",
    async (scope) => {
      const { clock, read } = setup();
      await clock.refresh();
      const old = deferred<WorkSnapshot | null>();
      read.mockReturnValueOnce(old.promise);
      void clock.refresh(true);
      await Promise.resolve();
      read.mockResolvedValue(null);
      clock.setScope(scope);
      expect(clock.getSnapshot().clock).toBeNull();
      await clock.refresh();
      old.resolve(snapshot("working", 10));
      await Promise.resolve();
      expect(clock.getSnapshot().scope).toBe(scope);
      expect(clock.getSnapshot().clock).toBeNull();
      expect(read).toHaveBeenLastCalledWith(scope);
    },
  );
  it("logout clears immediately, ignores focus refresh and late result", async () => {
    const { clock, read } = setup();
    await clock.refresh();
    const old = deferred<WorkSnapshot | null>();
    read.mockReturnValueOnce(old.promise);
    const task = clock.refresh(true);
    await Promise.resolve();
    clock.clear(true);
    old.resolve(snapshot());
    await task;
    await clock.refresh(true);
    expect(clock.getSnapshot()).toMatchObject({ clock: null, signedOut: true });
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("ignores a server snapshot older than last confirmed time", async () => {
    const { clock, read } = setup();
    read.mockResolvedValue(snapshot("on_break", 10));
    await clock.refresh();
    read.mockResolvedValue(snapshot("working", 2));
    await clock.refresh(true);
    expect(clock.getSnapshot()).toMatchObject({ phase: "unavailable", clock: null });
  });
  it("rejects conflicting states at identical server timestamps", async () => {
    const { clock, read } = setup();
    await clock.refresh();
    read.mockResolvedValue(snapshot("not_working"));
    await clock.refresh(true);
    expect(clock.getSnapshot().clock).toBeNull();
  });
  it("equivalent timestamp encodings cannot hide a conflicting state", async () => {
    const { clock, read } = setup();
    await clock.refresh();
    read.mockResolvedValue({
      ...snapshot("not_working"),
      serverTime: "2026-09-07T10:00:00+02:00",
    });
    await clock.refresh(true);
    expect(clock.getSnapshot().clock).toBeNull();
  });
  it("one lock protects header, panel and double clicks with only allowed form keys", async () => {
    const { clock, read, submit } = setup();
    await clock.refresh();
    const action = deferred<TimeClockActionState>();
    submit.mockReturnValue(action.promise);
    const first = clock.submit("start_break");
    expect(await clock.submit("clock_out")).toBe(false);
    expect(await clock.submit("start_break")).toBe(false);
    expect(submit).toHaveBeenCalledTimes(1);
    const [, form, scope] = submit.mock.calls[0]!;
    expect([...form.keys()].sort()).toEqual(["operation", "request_id"]);
    expect(scope).toBe("a:org");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(clock.getSnapshot().pending).toBe(true);
    read.mockResolvedValue(snapshot("on_break", 10));
    action.resolve({ status: "success", message: "done", requestId: "id-1" });
    await first;
    expect(clock.getSnapshot()).toMatchObject({
      pending: false,
      retry: null,
      clock: { status: "on_break" },
    });
    expect(clock.canSubmit("clock_out")).toBe(false);
    expect(clock.canSubmit("end_break")).toBe(true);
  });
  it("pre-action reads and contradictory post-action snapshots cannot restore old state", async () => {
    const { clock, read, submit } = setup();
    await clock.refresh();
    const old = deferred<WorkSnapshot | null>();
    read.mockReturnValueOnce(old.promise);
    const task = clock.refresh(true);
    await Promise.resolve();
    submit.mockResolvedValue({ status: "success", message: "done", requestId: "id-1" });
    read.mockResolvedValue(snapshot("working", 10));
    await clock.submit("start_break");
    expect(clock.getSnapshot().phase).toBe("unavailable");
    old.resolve(snapshot("working", 1));
    await task;
    read.mockResolvedValue(snapshot("on_break", 11));
    await clock.refresh(true);
    expect(clock.getSnapshot().clock?.status).toBe("on_break");
  });
  it("uncertain operations retain request ID and reject a different intent until acknowledged", async () => {
    const { clock, read, submit } = setup();
    await clock.refresh();
    submit.mockRejectedValueOnce(new Error("lost response"));
    read.mockResolvedValue(snapshot("working", 1));
    await clock.submit("clock_out");
    expect(clock.getSnapshot().retry).toBe("clock_out");
    expect(await clock.submit("start_break")).toBe(false);
    submit.mockResolvedValue({ status: "success", message: "done", requestId: "id-1" });
    read.mockResolvedValue(snapshot("not_working", 2));
    await clock.submit("clock_out");
    expect(submit.mock.calls.map((c) => c[1].get("request_id"))).toEqual([
      "id-1",
      "id-1",
    ]);
    submit.mockResolvedValue({ status: "success", message: "done", requestId: "id-2" });
    read.mockResolvedValue(snapshot("working", 3));
    await clock.submit("clock_in");
    expect(submit.mock.calls[2]![1].get("request_id")).toBe("id-2");
  });
  it("old mutations cannot update a changed scope even if it changes back", async () => {
    const { clock, read, submit } = setup();
    await clock.refresh();
    const action = deferred<TimeClockActionState>();
    submit.mockReturnValue(action.promise);
    const pending = clock.submit("clock_out");
    read.mockResolvedValue(snapshot("on_break", 1));
    clock.setScope("b:org");
    clock.setScope("a:org");
    await clock.refresh();
    action.resolve({ status: "success", requestId: "id-1", message: "old" });
    await pending;
    expect(clock.getSnapshot().clock?.status).toBe("on_break");
    expect(clock.getSnapshot().feedback.message).toBe("");
  });
  it.each(["not_working", "working", "on_break"] as const)(
    "%s exposes only valid interlocked intents",
    async (status) => {
      const { clock, read, submit } = setup();
      read.mockResolvedValue(snapshot(status));
      await clock.refresh();
      const possible = ["clock_in", "clock_out", "start_break", "end_break"] as const;
      const expected = {
        not_working: ["clock_in"],
        working: ["clock_out", "start_break"],
        on_break: ["end_break"],
      };
      expect(possible.filter((i) => clock.canSubmit(i))).toEqual(expected[status]);
      expect(submit).not.toHaveBeenCalled();
    },
  );
  it("stop cancels timers and ignores outstanding responses", async () => {
    const { clock, read } = setup();
    await clock.refresh();
    const old = deferred<WorkSnapshot | null>();
    read.mockReturnValueOnce(old.promise);
    const task = clock.refresh(true);
    await Promise.resolve();
    clock.stop();
    expect(vi.getTimerCount()).toBe(0);
    old.resolve(snapshot("not_working", 2));
    await task;
    expect(clock.getSnapshot().clock?.status).toBe("working");
    expect(clock.canSubmit("clock_out")).toBe(false);
  });
});
