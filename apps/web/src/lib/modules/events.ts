/**
 * `clock_events` rows as `@cloxa/domain` events, including the telework
 * location. Pure, so pages and loaders share one mapping.
 */
import type {
  ClockEvent,
  ClockEventSource,
  ClockEventType,
  WorkLocation,
} from "@cloxa/domain";

export const CLOCK_EVENT_COLUMNS =
  "id, type, occurred_at, employee_id, site_id, source, supersedes_event_id, correction_id, offline, server_at, work_location";

export interface ClockEventRow {
  id: string;
  type: string;
  occurred_at: string;
  employee_id: string;
  site_id: string;
  source: string;
  supersedes_event_id: string | null;
  correction_id: string | null;
  offline?: boolean | null;
  server_at?: string | null;
  work_location?: string | null;
}

function workLocation(value: string | null | undefined): WorkLocation | null {
  return value === "site" || value === "home" ? value : null;
}

export function clockEventFromRow(row: ClockEventRow): ClockEvent {
  const location = workLocation(row.work_location);
  return {
    id: row.id,
    type: row.type as ClockEventType,
    occurredAt: Date.parse(row.occurred_at),
    employeeId: row.employee_id,
    siteId: row.site_id,
    source: row.source as ClockEventSource,
    ...(row.supersedes_event_id ? { supersedesEventId: row.supersedes_event_id } : {}),
    ...(row.correction_id ? { correctionId: row.correction_id } : {}),
    ...(row.offline
      ? {
          offline: true,
          ...(row.server_at ? { serverAt: Date.parse(row.server_at) } : {}),
        }
      : {}),
    ...(location ? { workLocation: location } : {}),
  };
}
