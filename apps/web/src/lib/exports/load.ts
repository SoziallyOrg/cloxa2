import "server-only";

import { scheduleFor, type CloxaClient } from "@cloxa/db";
import type { ClockEvent, ClockEventSource, ClockEventType } from "@cloxa/domain";

import type { ActiveMembership } from "@/lib/auth/routing";

import { addDays, brusselsDayStart, type ExportPeriod } from "./brussels";
import type { SnapshotEmployee, SnapshotInput, SnapshotPlannedBlock } from "./snapshot";

/** PostgREST returns at most this many rows per request (supabase/config.toml max_rows). */
const PAGE = 1000;
/** Refuse instead of building an export nobody can open (the 10 MiB cap comes first anyway). */
const MAX_PAGES = 200;
/** A shift that starts on the last day may end the next day. */
const LOOKAHEAD_MS = 48 * 3600_000;
const IN_CHUNK = 100;
const SCHEDULE_CONCURRENCY = 6;

const EVENT_COLUMNS =
  "id, type, occurred_at, employee_id, site_id, source, supersedes_event_id, correction_id";

interface EventRow {
  id: string;
  type: string;
  occurred_at: string;
  employee_id: string;
  site_id: string;
  source: string;
  supersedes_event_id: string | null;
  correction_id: string | null;
}

interface PageResult<T> {
  data: T[] | null;
  error: { code: string } | null;
}

async function allPages<T>(
  label: string,
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await fetchPage(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`${label}_unavailable:${error.code}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
  throw new Error("too_many_events");
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function toClockEvent(row: EventRow): ClockEvent {
  return {
    id: row.id,
    type: row.type as ClockEventType,
    occurredAt: Date.parse(row.occurred_at),
    employeeId: row.employee_id,
    siteId: row.site_id,
    source: row.source as ClockEventSource,
    ...(row.supersedes_event_id ? { supersedesEventId: row.supersedes_event_id } : {}),
    ...(row.correction_id ? { correctionId: row.correction_id } : {}),
  };
}

/** Sites a privileged member may export: the whole org for owner/admin, managed sites for a manager. */
export async function loadExportableSites(
  supabase: CloxaClient,
  membership: ActiveMembership,
): Promise<{ id: string; name: string }[]> {
  let query = supabase
    .from("sites")
    .select("id, name")
    .eq("organization_id", membership.organizationId);

  if (membership.role !== "owner" && membership.role !== "admin") {
    const { data: managed, error } = await supabase
      .from("site_assignments")
      .select("site_id")
      .eq("membership_id", membership.id);
    if (error) throw new Error(`site_assignments_unavailable:${error.code}`);
    if (managed.length === 0) return [];
    query = query.in(
      "id",
      managed.map((row) => row.site_id),
    );
  }

  const { data, error } = await query.order("name").order("id");
  if (error) throw new Error(`sites_unavailable:${error.code}`);
  return data;
}

export interface LoadSnapshotOptions {
  readonly organizationId: string;
  readonly createdBy: string;
  readonly generatedAt: number;
  readonly period: ExportPeriod;
  /** Null: every site. */
  readonly siteIds: readonly string[] | null;
  /** Only these employees (a self export). Otherwise everyone RLS lets the caller see. */
  readonly employeeIds?: readonly string[];
}

/**
 * Everything `buildExportContent` needs, read as the caller through RLS. The
 * database still decides what the caller may see; this only asks.
 */
export async function loadSnapshotInput(
  supabase: CloxaClient,
  options: LoadSnapshotOptions,
): Promise<SnapshotInput> {
  const { organizationId, period, siteIds, employeeIds } = options;
  const windowStart = new Date(brusselsDayStart(period.from)).toISOString();
  const windowEnd = new Date(
    brusselsDayStart(addDays(period.to, 1)) + LOOKAHEAD_MS,
  ).toISOString();

  const eventRows = await allPages<EventRow>("clock_events", (from, to) => {
    let query = supabase
      .from("clock_events")
      .select(EVENT_COLUMNS)
      .eq("organization_id", organizationId)
      .gte("occurred_at", windowStart)
      .lt("occurred_at", windowEnd);
    if (employeeIds) query = query.in("employee_id", [...employeeIds]);
    return query.order("occurred_at").order("id").range(from, to);
  });

  // A correction may have moved an event out of the window; its superseding
  // event is still needed so the original stops counting.
  const correctionRows = await allPages<EventRow>("clock_events", (from, to) => {
    let query = supabase
      .from("clock_events")
      .select(EVENT_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("source", "correction")
      .gte("server_at", windowStart);
    if (employeeIds) query = query.in("employee_id", [...employeeIds]);
    return query.order("server_at").order("id").range(from, to);
  });

  const byId = new Map<string, ClockEvent>();
  for (const row of [...eventRows, ...correctionRows])
    byId.set(row.id, toClockEvent(row));
  const events = [...byId.values()];

  const { data: siteRows, error: sitesError } = await supabase
    .from("sites")
    .select("id, name")
    .eq("organization_id", organizationId);
  if (sitesError) throw new Error(`sites_unavailable:${sitesError.code}`);
  const siteNames = new Map(siteRows.map((site) => [site.id, site.name]));

  // Candidates: clocked in at an exported site, or assigned to one.
  const candidates = new Set<string>(employeeIds ?? []);
  if (!employeeIds) {
    const inScope = (siteId: string) => siteIds === null || siteIds.includes(siteId);
    for (const event of events) {
      if (event.type === "clock_in" && inScope(event.siteId)) {
        candidates.add(event.employeeId);
      }
    }
    let assignments = supabase
      .from("site_assignments")
      .select("employee_id, site_id")
      .eq("organization_id", organizationId)
      .not("employee_id", "is", null);
    if (siteIds !== null) assignments = assignments.in("site_id", [...siteIds]);
    const { data: assignmentRows, error } = await assignments;
    if (error) throw new Error(`site_assignments_unavailable:${error.code}`);
    for (const row of assignmentRows) {
      if (row.employee_id) candidates.add(row.employee_id);
    }
  }

  const employees: SnapshotEmployee[] = [];
  for (const ids of chunks([...candidates], IN_CHUNK)) {
    const { data, error } = await supabase
      .from("employees")
      .select("id, display_name, employee_code")
      .eq("organization_id", organizationId)
      .in("id", ids);
    if (error) throw new Error(`employees_unavailable:${error.code}`);
    for (const row of data) {
      employees.push({ id: row.id, code: row.employee_code, name: row.display_name });
    }
  }

  const planned: SnapshotPlannedBlock[] = [];
  for (const batch of chunks(employees, SCHEDULE_CONCURRENCY)) {
    const results = await Promise.all(
      batch.map((employee) =>
        scheduleFor(supabase, {
          employeeId: employee.id,
          from: period.from,
          to: period.to,
        }).then((rows) => ({ employeeId: employee.id, rows })),
      ),
    );
    for (const { employeeId, rows } of results) {
      for (const row of rows) {
        planned.push({
          employeeId,
          day: row.day,
          start: Date.parse(row.start_at),
          end: Date.parse(row.end_at),
        });
      }
    }
  }

  const visible = new Set(employees.map((employee) => employee.id));
  return {
    organizationId,
    createdBy: options.createdBy,
    generatedAt: options.generatedAt,
    period,
    siteIds,
    siteNames,
    employees,
    events: events.filter((event) => visible.has(event.employeeId)),
    planned,
  };
}
