/**
 * Pure mapping for the offline sync: database answers to queue outcomes, and
 * queue outcomes to the message the employee sees. No `t()` here; callers
 * translate the returned key.
 */
import { RpcError, type ClockOfflineResult } from "@cloxa/db";
import { formatBrusselsShortDate, formatBrusselsTime } from "@cloxa/i18n";

import type { QueueEntry, SettledOutcome, SyncOutcome } from "./queue";

/** The server action's answer for one entry. */
export function outcomeFromResult(result: ClockOfflineResult): SyncOutcome {
  switch (result.outcome) {
    case "recorded":
      return { outcome: "recorded" };
    case "correction_requested":
      return { outcome: "correction_requested", reason: result.reason };
    case "rejected":
      return { outcome: "rejected", reason: result.reason };
  }
}

/**
 * A refusal that will never change on retry drops the entry (with a
 * message); anything else (a timeout, a 5xx, a lost connection between the
 * server and the database) keeps it queued.
 */
export function outcomeFromError(error: unknown): SyncOutcome {
  // By name: @cloxa/db may resolve its own copy of zod.
  if (error instanceof Error && error.name === "ZodError") {
    return { outcome: "rejected", reason: "invalid_input" };
  }
  if (error instanceof RpcError && (error.code === "42501" || error.code === "22023")) {
    return { outcome: "rejected", reason: error.message };
  }
  return { outcome: "retry" };
}

export type OfflineMessageKey =
  | "offline.correctionRequested"
  | "offline.rejectedDisabled"
  | "offline.rejectedDeviceClock"
  | "offline.rejectedTooOld"
  | "offline.rejectedGeneric"
  | "offline.staleDropped";

export interface OfflineMessage {
  readonly tone: "info" | "error";
  readonly key: OfflineMessageKey;
  readonly values: Readonly<Record<string, string>>;
}

/** What to tell the employee about a settled entry; recorded needs no words. */
export function messageFor(
  entry: QueueEntry,
  result: SettledOutcome,
): OfflineMessage | null {
  const values = { time: formatBrusselsTime(new Date(entry.capturedAt)) };
  switch (result.outcome) {
    case "recorded":
      return null;
    case "correction_requested":
      return { tone: "info", key: "offline.correctionRequested", values };
    case "rejected":
      return { tone: "error", key: rejectedKey(result.reason), values };
  }
}

/** For an entry dropped on the device because it can never be sent. */
export function staleMessage(entry: QueueEntry): OfflineMessage {
  const at = new Date(entry.capturedAt);
  return {
    tone: "error",
    key: "offline.staleDropped",
    values: { date: formatBrusselsShortDate(at), time: formatBrusselsTime(at) },
  };
}

function rejectedKey(reason: string): OfflineMessageKey {
  switch (reason) {
    case "offline_disabled":
      return "offline.rejectedDisabled";
    case "captured_in_future":
      return "offline.rejectedDeviceClock";
    case "captured_too_old":
      return "offline.rejectedTooOld";
    default:
      return "offline.rejectedGeneric";
  }
}
