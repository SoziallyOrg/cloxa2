/**
 * "Was / Wordt" for the employee's own correction requests: replays the
 * proposal against the registrations it points at. Pure; the page reads the
 * target events under RLS and hands them in.
 */
import {
  formatBrusselsShortDate,
  formatBrusselsTime,
  t,
  type CatalogKey,
} from "@cloxa/i18n";

export interface TargetEvent {
  readonly id: string;
  readonly type: string;
  /** ISO instant. */
  readonly occurredAt: string;
}

export interface RequestChange {
  /** "Begonnen met werken". */
  readonly typeLabel: string;
  /** "08:30" or "geen". */
  readonly was: string;
  /** "08:00" or "verwijderd". */
  readonly willBe: string;
}

export interface RequestChanges {
  readonly changes: readonly RequestChange[];
  /** "di 29 sep": the day the change is about, when known. */
  readonly dayLabel: string | null;
}

const TYPE_LABEL: Record<string, CatalogKey> = {
  clock_in: "correctionForm.eventTypeClockIn",
  clock_out: "correctionForm.eventTypeClockOut",
  break_start: "correctionForm.eventTypeBreakStart",
  break_end: "correctionForm.eventTypeBreakEnd",
};

const typeLabel = (type: string) => {
  const key = TYPE_LABEL[type];
  return key ? t(key) : type;
};

const clock = (iso: string) => formatBrusselsTime(new Date(iso));

function proposedEvents(proposed: unknown): Record<string, unknown>[] {
  if (typeof proposed !== "object" || proposed === null) return [];
  const events = (proposed as { events?: unknown }).events;
  return Array.isArray(events)
    ? events.filter(
        (event): event is Record<string, unknown> =>
          typeof event === "object" && event !== null,
      )
    : [];
}

export function requestChanges(input: {
  kind: string;
  proposed: unknown;
  targetEventIds: readonly string[];
  targetEvents: readonly TargetEvent[];
}): RequestChanges {
  const byId = new Map(input.targetEvents.map((event) => [event.id, event]));
  const changes: RequestChange[] = [];
  let dayIso: string | null = null;

  if (input.kind === "add") {
    for (const event of proposedEvents(input.proposed)) {
      const at = event["occurred_at"];
      const type = event["type"];
      if (typeof at !== "string" || typeof type !== "string") continue;
      dayIso ??= at;
      changes.push({
        typeLabel: typeLabel(type),
        was: t("questions.wasNone"),
        willBe: clock(at),
      });
    }
  } else if (input.kind === "adjust") {
    for (const event of proposedEvents(input.proposed)) {
      const at = event["occurred_at"];
      const targetId = event["target_event_id"];
      const target = typeof targetId === "string" ? byId.get(targetId) : undefined;
      if (typeof at !== "string" || !target) continue;
      dayIso ??= at;
      changes.push({
        typeLabel: typeLabel(target.type),
        was: clock(target.occurredAt),
        willBe: clock(at),
      });
    }
  } else if (input.kind === "remove") {
    for (const id of input.targetEventIds) {
      const target = byId.get(id);
      if (!target) continue;
      dayIso ??= target.occurredAt;
      changes.push({
        typeLabel: typeLabel(target.type),
        was: clock(target.occurredAt),
        willBe: t("questions.willBeRemoved"),
      });
    }
  }

  return {
    changes,
    dayLabel: dayIso ? formatBrusselsShortDate(new Date(dayIso)) : null,
  };
}
