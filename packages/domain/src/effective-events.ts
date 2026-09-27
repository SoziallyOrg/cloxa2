import type { ClockEvent } from "./clock-event";

/**
 * Effective events are events that no other event supersedes. A `void`
 * event supersedes without replacing, and is itself never effective.
 *
 * Returned events are sorted by `occurredAt`, then `id`, so callers get a
 * stable, chronological log to fold over.
 */
export function effectiveEvents(events: readonly ClockEvent[]): ClockEvent[] {
  const superseded = new Set<string>();

  for (const event of events) {
    if (event.supersedesEventId !== undefined) {
      superseded.add(event.supersedesEventId);
    }
  }

  return events
    .filter((event) => event.type !== "void" && !superseded.has(event.id))
    .slice()
    .sort((a, b) => a.occurredAt - b.occurredAt || compareIds(a.id, b.id));
}

function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
