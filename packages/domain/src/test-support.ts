import type { ClockEvent, ClockEventSource, ClockEventType } from "./clock-event";

/** Builds a full ClockEvent from minimal overrides, for tests only. */
export function makeEvent(overrides: {
  id: string;
  type: ClockEventType;
  occurredAt: number;
  employeeId?: string;
  siteId?: string;
  source?: ClockEventSource;
  supersedesEventId?: string;
  correctionId?: string;
}): ClockEvent {
  const event: ClockEvent = {
    id: overrides.id,
    type: overrides.type,
    occurredAt: overrides.occurredAt,
    employeeId: overrides.employeeId ?? "employee-1",
    siteId: overrides.siteId ?? "site-1",
    source: overrides.source ?? "app",
  };

  return {
    ...event,
    ...(overrides.supersedesEventId !== undefined
      ? { supersedesEventId: overrides.supersedesEventId }
      : {}),
    ...(overrides.correctionId !== undefined
      ? { correctionId: overrides.correctionId }
      : {}),
  };
}
