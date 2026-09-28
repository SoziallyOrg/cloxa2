import { describe, expect, it } from "vitest";

import { RpcError } from "@cloxa/db";

import {
  messageFor,
  outcomeFromError,
  outcomeFromResult,
  staleMessage,
} from "./outcome";
import type { QueueEntry } from "./queue";

const ENTRY: QueueEntry = {
  employeeId: "emp-1",
  type: "clock_in",
  idempotencyKey: "k1",
  siteId: "site-1",
  // 08:02 in Brussels (CEST).
  capturedAt: "2026-09-28T06:02:00.000Z",
  attempts: 0,
};

describe("outcomeFromResult", () => {
  it("keeps the outcome and the reason", () => {
    expect(outcomeFromResult({ outcome: "recorded", eventId: "e" })).toEqual({
      outcome: "recorded",
    });
    expect(
      outcomeFromResult({
        outcome: "correction_requested",
        correctionId: "c",
        reason: "later_event_exists",
      }),
    ).toEqual({ outcome: "correction_requested", reason: "later_event_exists" });
    expect(
      outcomeFromResult({ outcome: "rejected", reason: "offline_disabled" }),
    ).toEqual({
      outcome: "rejected",
      reason: "offline_disabled",
    });
  });
});

describe("outcomeFromError", () => {
  it("drops the entry on a permanent refusal", () => {
    const reused = new RpcError("rpc_clock_offline", {
      message: "idempotency_key_reused",
      code: "22023",
    });
    const foreign = new RpcError("rpc_clock_offline", {
      message: "not_authorized",
      code: "42501",
    });
    expect(outcomeFromError(reused)).toEqual({
      outcome: "rejected",
      reason: "idempotency_key_reused",
    });
    expect(outcomeFromError(foreign)).toEqual({
      outcome: "rejected",
      reason: "not_authorized",
    });
  });

  it("drops an entry that fails input validation", () => {
    const zod = Object.assign(new Error("bad"), { name: "ZodError" });
    expect(outcomeFromError(zod)).toEqual({
      outcome: "rejected",
      reason: "invalid_input",
    });
  });

  it("keeps the entry on anything transient", () => {
    const deadlock = new RpcError("rpc_clock_offline", {
      message: "deadlock",
      code: "40P01",
    });
    expect(outcomeFromError(deadlock)).toEqual({ outcome: "retry" });
    expect(outcomeFromError(new TypeError("fetch failed"))).toEqual({
      outcome: "retry",
    });
  });
});

describe("messageFor", () => {
  it("says nothing for a recorded entry", () => {
    expect(messageFor(ENTRY, { outcome: "recorded" })).toBeNull();
  });

  it("tells the employee a request went to the manager, with the captured time", () => {
    expect(
      messageFor(ENTRY, {
        outcome: "correction_requested",
        reason: "invalid_transition",
      }),
    ).toEqual({
      tone: "info",
      key: "offline.correctionRequested",
      values: { time: "08:02" },
    });
  });

  it("maps each rejection to a clear message", () => {
    const key = (reason: string) =>
      messageFor(ENTRY, { outcome: "rejected", reason })?.key;
    expect(key("offline_disabled")).toBe("offline.rejectedDisabled");
    expect(key("captured_in_future")).toBe("offline.rejectedDeviceClock");
    expect(key("captured_too_old")).toBe("offline.rejectedTooOld");
    expect(key("site_inactive")).toBe("offline.rejectedGeneric");
    expect(messageFor(ENTRY, { outcome: "rejected", reason: "x" })?.tone).toBe("error");
  });
});

describe("staleMessage", () => {
  it("names the date and time of the dropped entry", () => {
    expect(staleMessage(ENTRY)).toEqual({
      tone: "error",
      key: "offline.staleDropped",
      values: { date: "ma 28 sep", time: "08:02" },
    });
  });
});
