/**
 * Pure "aandacht nodig" rules for the manager's Vandaag board. No I/O: the
 * page reads real data (shifts, schedules, pending corrections) and passes
 * plain values in here.
 */
import { brusselsDayKey } from "@cloxa/domain";

const FORGOT_CLOCK_OUT_MS = 12 * 3600 * 1000;
const LONG_BREAK_MS = 60 * 60 * 1000;
const NOT_STARTED_GRACE_MS = 15 * 60 * 1000;
const OFFLINE_DELAY_MS = 5 * 60 * 1000;
const OFFLINE_WEEKLY_MIN = 3;

export type AttentionReason =
  | "forgotClockOut"
  | "longBreak"
  | "notStarted"
  | "offlineDelayed"
  | "offlineWeekly"
  | "pendingQuestions";

export interface AttentionItem {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly reason: AttentionReason;
  /** `pendingQuestions`: how many are pending; `offlineWeekly`: how many events. */
  readonly count?: number;
}

export interface OpenShiftStatus {
  readonly employeeId: string;
  readonly employeeName: string;
  /** Epoch ms the open shift started. */
  readonly startedAt: number;
  /** Epoch ms the current open break started, or `null` when not on break. */
  readonly openBreakStartedAt: number | null;
}

export interface ScheduledStart {
  readonly employeeId: string;
  readonly employeeName: string;
  /** Epoch ms of today's scheduled start. */
  readonly startAt: number;
}

/** Open shift longer than 12h, or open from a previous Brussels day. */
export function forgottenClockOuts(
  shifts: readonly OpenShiftStatus[],
  now: number,
): AttentionItem[] {
  return shifts
    .filter(
      (shift) =>
        now - shift.startedAt > FORGOT_CLOCK_OUT_MS ||
        brusselsDayKey(shift.startedAt) !== brusselsDayKey(now),
    )
    .map((shift) => ({
      id: `forgot-${shift.employeeId}`,
      employeeId: shift.employeeId,
      employeeName: shift.employeeName,
      reason: "forgotClockOut" as const,
    }));
}

/** Open break over 60 minutes. */
export function longBreaks(
  shifts: readonly OpenShiftStatus[],
  now: number,
): AttentionItem[] {
  return shifts
    .filter(
      (shift) =>
        shift.openBreakStartedAt !== null &&
        now - shift.openBreakStartedAt > LONG_BREAK_MS,
    )
    .map((shift) => ({
      id: `break-${shift.employeeId}`,
      employeeId: shift.employeeId,
      employeeName: shift.employeeName,
      reason: "longBreak" as const,
    }));
}

/** Scheduled start passed by 15 minutes and no clock_in yet. */
export function notStartedAttention(
  scheduled: readonly ScheduledStart[],
  clockedInEmployeeIds: ReadonlySet<string>,
  now: number,
): AttentionItem[] {
  return scheduled
    .filter(
      (entry) =>
        now - entry.startAt > NOT_STARTED_GRACE_MS &&
        !clockedInEmployeeIds.has(entry.employeeId),
    )
    .map((entry) => ({
      id: `notstarted-${entry.employeeId}`,
      employeeId: entry.employeeId,
      employeeName: entry.employeeName,
      reason: "notStarted" as const,
    }));
}

export interface OfflineEvent {
  readonly employeeId: string;
  readonly employeeName: string;
  /** Epoch ms the fact refers to (the captured device time). */
  readonly occurredAt: number;
  /** Epoch ms the server received it. */
  readonly serverAt: number;
}

/**
 * Offline events synced today (Brussels) that reached the server more than 5
 * minutes after their captured time (ADR 006). Keyed on the sync day, so an
 * event backdated to yesterday still shows today. One item per employee.
 */
export function offlineDelayedAttention(
  events: readonly OfflineEvent[],
  now: number,
): AttentionItem[] {
  const today = brusselsDayKey(now);
  const seen = new Set<string>();
  const items: AttentionItem[] = [];
  for (const event of events) {
    if (
      seen.has(event.employeeId) ||
      brusselsDayKey(event.serverAt) !== today ||
      event.serverAt - event.occurredAt <= OFFLINE_DELAY_MS
    ) {
      continue;
    }
    seen.add(event.employeeId);
    items.push({
      id: `offline-${event.employeeId}`,
      employeeId: event.employeeId,
      employeeName: event.employeeName,
      reason: "offlineDelayed",
    });
  }
  return items;
}

/**
 * Employees with 3 or more offline events among `events` (the caller passes
 * this week's, by sync time): a pattern worth a look, not an accusation.
 */
export function offlineWeeklyAttention(
  events: readonly OfflineEvent[],
): AttentionItem[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const event of events) {
    const current = counts.get(event.employeeId);
    counts.set(event.employeeId, {
      name: event.employeeName,
      count: (current?.count ?? 0) + 1,
    });
  }
  return [...counts]
    .filter(([, entry]) => entry.count >= OFFLINE_WEEKLY_MIN)
    .map(([employeeId, entry]) => ({
      id: `offline-week-${employeeId}`,
      employeeId,
      employeeName: entry.name,
      reason: "offlineWeekly" as const,
      count: entry.count,
    }));
}

/** One summary item for the pending correction requests, when there are any. */
export function pendingQuestionsAttention(count: number): AttentionItem[] {
  if (count <= 0) return [];
  return [
    {
      id: "pending-questions",
      employeeId: "",
      employeeName: "",
      reason: "pendingQuestions",
      count,
    },
  ];
}

export interface BuildAttentionInput {
  readonly openShifts: readonly OpenShiftStatus[];
  readonly scheduledStarts: readonly ScheduledStart[];
  readonly clockedInEmployeeIds: ReadonlySet<string>;
  /** This Brussels week's offline events, by sync time (`server_at`). */
  readonly offlineEvents: readonly OfflineEvent[];
  readonly pendingCorrectionsCount: number;
  readonly now: number;
}

/** Every "aandacht nodig" rule, combined in a stable order. */
export function buildAttention(input: BuildAttentionInput): AttentionItem[] {
  return [
    ...forgottenClockOuts(input.openShifts, input.now),
    ...longBreaks(input.openShifts, input.now),
    ...notStartedAttention(
      input.scheduledStarts,
      input.clockedInEmployeeIds,
      input.now,
    ),
    ...offlineDelayedAttention(input.offlineEvents, input.now),
    ...offlineWeeklyAttention(input.offlineEvents),
    ...pendingQuestionsAttention(input.pendingCorrectionsCount),
  ];
}
