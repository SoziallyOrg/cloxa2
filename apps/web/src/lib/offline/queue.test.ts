import { describe, expect, it } from "vitest";

import {
  displayedState,
  memoryQueueStorage,
  pendingFor,
  STALE_AFTER_MS,
  syncQueue,
  type QueueEntry,
  type SyncOutcome,
} from "./queue";

function entry(
  idempotencyKey: string,
  type: QueueEntry["type"],
  capturedAt: string,
  employeeId = "emp-1",
): QueueEntry {
  return {
    employeeId,
    type,
    idempotencyKey,
    siteId: "site-1",
    capturedAt,
    attempts: 0,
  };
}

const IN = entry("k1", "clock_in", "2026-09-28T06:02:00.000Z");
const BREAK = entry("k2", "break_start", "2026-09-28T09:00:00.000Z");
const OUT = entry("k3", "clock_out", "2026-09-28T14:00:00.000Z");

describe("memoryQueueStorage", () => {
  it("keeps insertion order and ignores a second add with the same key", async () => {
    const storage = memoryQueueStorage();
    await storage.add(IN);
    await storage.add(BREAK);
    await storage.add({ ...IN, capturedAt: "2026-09-28T07:00:00.000Z" });
    expect(await storage.list()).toEqual([IN, BREAK]);
  });

  it("updates in place and removes by key", async () => {
    const storage = memoryQueueStorage([IN, BREAK]);
    await storage.update({ ...IN, attempts: 2 });
    await storage.remove("k2");
    expect(await storage.list()).toEqual([{ ...IN, attempts: 2 }]);
  });
});

describe("clear", () => {
  it("removes one employee's entries only", async () => {
    const other = entry("k9", "clock_in", "2026-09-28T06:00:00.000Z", "emp-2");
    const storage = memoryQueueStorage([IN, other, BREAK]);
    await storage.clear("emp-1");
    expect(await storage.list()).toEqual([other]);
  });
});

describe("stale entries", () => {
  const now = Date.parse("2026-09-28T12:00:00.000Z");
  const old = entry(
    "k0",
    "clock_in",
    new Date(now - STALE_AFTER_MS - 1000).toISOString(),
  );
  const othersOld = { ...old, idempotencyKey: "k8", employeeId: "emp-2" };

  it("drops entries that can never be recorded, reports only the employee's own, sends the rest", async () => {
    const storage = memoryQueueStorage([old, othersOld, IN]);
    const sent: string[] = [];
    const report = await syncQueue(
      storage,
      "emp-1",
      (queued) => {
        sent.push(queued.idempotencyKey);
        return Promise.resolve<SyncOutcome>({ outcome: "recorded" });
      },
      now,
    );
    expect(report.dropped).toEqual([old]);
    expect(sent).toEqual(["k1"]);
    expect(await storage.list()).toEqual([]);
  });

  it("keeps an entry older than 72 hours: the server turns it into a correction request", async () => {
    const threeDaysAgo = entry(
      "k4",
      "clock_in",
      new Date(now - 4 * 86_400_000).toISOString(),
    );
    const storage = memoryQueueStorage([threeDaysAgo]);
    const report = await syncQueue(
      storage,
      "emp-1",
      () => Promise.resolve<SyncOutcome>({ outcome: "retry" }),
      now,
    );
    expect(report.dropped).toEqual([]);
    expect(await storage.list()).toEqual([{ ...threeDaysAgo, attempts: 1 }]);
  });
});

describe("purge after a full sync", () => {
  it("clears the employee's leftovers when every entry was answered", async () => {
    const base = memoryQueueStorage([IN]);
    // A remove that silently fails (e.g. another tab held the store).
    const storage = { ...base, remove: () => Promise.resolve() };
    await syncQueue(storage, "emp-1", () =>
      Promise.resolve<SyncOutcome>({ outcome: "recorded" }),
    );
    expect(await base.list()).toEqual([]);
  });

  it("never clears an action queued while the sync ran", async () => {
    const storage = memoryQueueStorage([IN]);
    await syncQueue(storage, "emp-1", async () => {
      await storage.add(OUT);
      return { outcome: "recorded" };
    });
    expect(await storage.list()).toEqual([OUT]);
  });
});

describe("pendingFor", () => {
  it("only returns the signed-in employee's entries", () => {
    const other = entry("k9", "clock_in", "2026-09-28T06:00:00.000Z", "emp-2");
    expect(pendingFor([IN, other, BREAK], "emp-1")).toEqual([IN, BREAK]);
  });
});

describe("syncQueue", () => {
  it("sends oldest first and removes every settled entry", async () => {
    const storage = memoryQueueStorage([IN, BREAK, OUT]);
    const sent: string[] = [];
    const report = await syncQueue(storage, "emp-1", (queued) => {
      sent.push(queued.idempotencyKey);
      return Promise.resolve<SyncOutcome>(
        queued.type === "break_start"
          ? { outcome: "correction_requested", reason: "later_event_exists" }
          : { outcome: "recorded" },
      );
    });
    expect(sent).toEqual(["k1", "k2", "k3"]);
    expect(report.stopped).toBe(false);
    expect(report.settled.map((s) => s.result.outcome)).toEqual([
      "recorded",
      "correction_requested",
      "recorded",
    ]);
    expect(await storage.list()).toEqual([]);
  });

  it("stops at the first transient failure and keeps the rest in order", async () => {
    const storage = memoryQueueStorage([IN, BREAK, OUT]);
    const sent: string[] = [];
    const report = await syncQueue(storage, "emp-1", (queued) => {
      sent.push(queued.idempotencyKey);
      return Promise.resolve<SyncOutcome>(
        queued.idempotencyKey === "k2" ? { outcome: "retry" } : { outcome: "recorded" },
      );
    });
    expect(sent).toEqual(["k1", "k2"]);
    expect(report.stopped).toBe(true);
    expect(await storage.list()).toEqual([{ ...BREAK, attempts: 1 }, OUT]);
  });

  it("treats a throwing send (network down) as transient", async () => {
    const storage = memoryQueueStorage([IN]);
    const report = await syncQueue(storage, "emp-1", () =>
      Promise.reject(new TypeError("Failed to fetch")),
    );
    expect(report).toEqual({ settled: [], dropped: [], stopped: true });
    expect(await storage.list()).toEqual([{ ...IN, attempts: 1 }]);
  });

  it("drops a rejected entry and carries on", async () => {
    const storage = memoryQueueStorage([IN, BREAK]);
    const report = await syncQueue(storage, "emp-1", (queued) =>
      Promise.resolve<SyncOutcome>(
        queued.idempotencyKey === "k1"
          ? { outcome: "rejected", reason: "offline_disabled" }
          : { outcome: "recorded" },
      ),
    );
    expect(report.settled.map((s) => s.entry.idempotencyKey)).toEqual(["k1", "k2"]);
    expect(await storage.list()).toEqual([]);
  });

  it("never sends another employee's entries", async () => {
    const other = entry("k9", "clock_in", "2026-09-28T06:00:00.000Z", "emp-2");
    const storage = memoryQueueStorage([other, IN]);
    const sent: string[] = [];
    await syncQueue(storage, "emp-1", (queued) => {
      sent.push(queued.idempotencyKey);
      return Promise.resolve<SyncOutcome>({ outcome: "recorded" });
    });
    expect(sent).toEqual(["k1"]);
    expect(await storage.list()).toEqual([other]);
  });
});

describe("displayedState", () => {
  it("applies queued actions on top of the server state", () => {
    expect(displayedState({ state: "off", since: null }, [IN])).toEqual({
      state: "working",
      since: Date.parse(IN.capturedAt),
    });
    expect(displayedState({ state: "off", since: null }, [IN, BREAK])).toEqual({
      state: "on_break",
      since: Date.parse(IN.capturedAt),
    });
    expect(displayedState({ state: "working", since: 1 }, [OUT])).toEqual({
      state: "off",
      since: null,
    });
  });

  it("skips a queued action that no longer fits (already synced or invalid)", () => {
    expect(displayedState({ state: "working", since: 5 }, [IN])).toEqual({
      state: "working",
      since: 5,
    });
  });
});
