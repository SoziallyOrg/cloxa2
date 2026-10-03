/**
 * Pure "voor -> na" diff building for a correction request, for the
 * manager's Aanvragen page. Replays the proposal against the employee's
 * current effective events with `@cloxa/domain`, so the resulting shift
 * shown to the manager is the same shape the employee sees.
 */
import {
  deriveShifts,
  effectiveEvents,
  type ClockEvent,
  type ClockEventType,
  type Shift,
} from "@cloxa/domain";

export interface ProposedAddEvent {
  readonly type: ClockEventType;
  readonly occurred_at: string;
  readonly site_id: string;
}

export interface ProposedAdjustEvent {
  readonly target_event_id: string;
  readonly occurred_at: string;
}

export type CorrectionKind = "add" | "adjust" | "remove";

export interface CorrectionRequestLike {
  readonly kind: CorrectionKind;
  readonly targetEventIds: readonly string[];
  readonly proposed: {
    readonly events?: readonly (ProposedAddEvent | ProposedAdjustEvent)[];
  };
}

export interface EventChange {
  readonly type: ClockEventType;
  /** ISO instant, `null` when the event is newly added. */
  readonly beforeIso: string | null;
  /** ISO instant, `null` when the event is removed. */
  readonly afterIso: string | null;
}

export interface CorrectionDiff {
  readonly changes: readonly EventChange[];
  readonly beforeShifts: readonly Shift[];
  readonly afterShifts: readonly Shift[];
}

let addCounter = 0;

/**
 * `employeeEvents` is the employee's raw event log (any order); this
 * function derives effective events itself, both before and after applying
 * the proposal.
 */
export function buildCorrectionDiff(
  request: CorrectionRequestLike,
  employeeEvents: readonly ClockEvent[],
): CorrectionDiff {
  const before = effectiveEvents(employeeEvents);
  const beforeShifts = deriveShifts(before);
  const beforeById = new Map(before.map((event) => [event.id, event]));

  const changes: EventChange[] = [];
  let after: ClockEvent[];

  if (request.kind === "add") {
    const additions = (request.proposed.events ?? []) as ProposedAddEvent[];
    const referenceEmployeeId = before[0]?.employeeId ?? "";
    const added: ClockEvent[] = additions.map((event) => ({
      id: `proposed-${(addCounter += 1)}`,
      type: event.type,
      occurredAt: Date.parse(event.occurred_at),
      employeeId: referenceEmployeeId,
      siteId: event.site_id,
      source: "correction",
    }));
    after = [...before, ...added];
    for (const event of additions) {
      changes.push({ type: event.type, beforeIso: null, afterIso: event.occurred_at });
    }
  } else if (request.kind === "adjust") {
    const adjustments = (request.proposed.events ?? []) as ProposedAdjustEvent[];
    const byTarget = new Map(
      adjustments.map((event) => [event.target_event_id, event.occurred_at]),
    );
    after = before.map((event) => {
      const newIso = byTarget.get(event.id);
      if (newIso === undefined) return event;
      return { ...event, occurredAt: Date.parse(newIso), source: "correction" };
    });
    for (const [targetId, newIso] of byTarget) {
      const original = beforeById.get(targetId);
      if (original === undefined) continue;
      changes.push({
        type: original.type,
        beforeIso: new Date(original.occurredAt).toISOString(),
        afterIso: newIso,
      });
    }
  } else {
    const targets = new Set(request.targetEventIds);
    after = before.filter((event) => !targets.has(event.id));
    for (const targetId of targets) {
      const original = beforeById.get(targetId);
      if (original === undefined) continue;
      changes.push({
        type: original.type,
        beforeIso: new Date(original.occurredAt).toISOString(),
        afterIso: null,
      });
    }
  }

  const sortedAfter = after
    .slice()
    .sort((a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id));
  const afterShifts = deriveShifts(effectiveEvents(sortedAfter));

  return { changes, beforeShifts, afterShifts };
}
