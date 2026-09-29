import "server-only";

import { scheduleFor, type CloxaClient } from "@cloxa/db";
import type { ClockEvent } from "@cloxa/domain";
import { brusselsLocalToInstant } from "@cloxa/i18n";
import { appliesTo, interimAgency, isModuleId, type ModuleId } from "@cloxa/modules";

import type { ActiveMembership } from "@/lib/auth/routing";
import { clockEventFromRow, type ClockEventRow } from "@/lib/modules/events";
import { loadEnabledModules } from "@/lib/modules/load";

import { addDays, brusselsDayStart, type ExportPeriod } from "./brussels";
import type {
  SnapshotEmployee,
  SnapshotInput,
  SnapshotModules,
  SnapshotPlannedBlock,
} from "./snapshot";

/** PostgREST returns at most this many rows per request (supabase/config.toml max_rows). */
const PAGE = 1000;
/** Refuse instead of building an export nobody can open (the 10 MiB cap comes first anyway). */
const MAX_PAGES = 200;
/** A shift that starts on the last day may end the next day. */
const LOOKAHEAD_MS = 48 * 3600_000;
const IN_CHUNK = 100;
const SCHEDULE_CONCURRENCY = 6;

const EVENT_COLUMNS =
  "id, type, occurred_at, employee_id, site_id, source, supersedes_event_id, correction_id, work_location";

type EventRow = ClockEventRow;

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

const toClockEvent = (row: EventRow): ClockEvent => clockEventFromRow(row);

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
  /**
   * Add the enabled modules' columns (ADR 008). Off for self exports, which
   * stay the plain hours.
   */
  readonly withModules?: boolean;
  /** Only this interim agency's workers; needs `withModules` and the interim module. */
  readonly interimAgency?: string | null;
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

  const enabled = options.withModules
    ? await loadEnabledModules(supabase, organizationId)
    : [];
  const statutes = new Map<string, string>();
  let employees: SnapshotEmployee[] = [];
  for (const ids of chunks([...candidates], IN_CHUNK)) {
    const { data, error } = await supabase
      .from("employees")
      .select("id, display_name, employee_code, statute")
      .eq("organization_id", organizationId)
      .in("id", ids);
    if (error) throw new Error(`employees_unavailable:${error.code}`);
    for (const row of data) {
      employees.push({ id: row.id, code: row.employee_code, name: row.display_name });
      statutes.set(row.id, row.statute);
    }
  }

  let modules: SnapshotModules | null = null;
  if (enabled.length > 0) {
    const data = await loadModuleDataFor(
      supabase,
      organizationId,
      employees.map((employee) => employee.id),
    );
    const agency = options.interimAgency ?? null;
    if (agency !== null) {
      employees = employees.filter(
        (employee) => interimAgency(data.get(employee.id)?.get("interim")) === agency,
      );
    }
    const needYear = employees.filter((employee) =>
      enabled.some(
        ({ module }) =>
          module.needsYearToDate &&
          appliesTo(module, statutes.get(employee.id) ?? "other"),
      ),
    );
    modules = {
      enabled,
      statutes,
      data,
      yearEvents: await loadYearEvents(supabase, {
        organizationId,
        periodFrom: period.from,
        windowEnd,
        employeeIds: needYear.map((employee) => employee.id),
      }),
      interimAgency: agency,
    };
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
    planned: planned.filter((block) => visible.has(block.employeeId)),
    modules,
  };
}

/** Module data of these employees, per employee and module. */
async function loadModuleDataFor(
  supabase: CloxaClient,
  organizationId: string,
  employeeIds: readonly string[],
): Promise<Map<string, Map<ModuleId, unknown>>> {
  const byEmployee = new Map<string, Map<ModuleId, unknown>>();
  for (const ids of chunks(employeeIds, IN_CHUNK)) {
    const { data, error } = await supabase
      .from("employee_module_data")
      .select("employee_id, module, data")
      .eq("organization_id", organizationId)
      .in("employee_id", ids);
    if (error) throw new Error(`employee_module_data_unavailable:${error.code}`);
    for (const row of data) {
      if (!isModuleId(row.module)) continue;
      const entry = byEmployee.get(row.employee_id) ?? new Map<ModuleId, unknown>();
      entry.set(row.module, row.data);
      byEmployee.set(row.employee_id, entry);
    }
  }
  return byEmployee;
}

/**
 * Events from 1 January of the period's first year up to the export window's
 * end, for the year-to-date columns; corrections made since then too, so a
 * moved event stops counting.
 */
async function loadYearEvents(
  supabase: CloxaClient,
  query: {
    organizationId: string;
    periodFrom: string;
    windowEnd: string;
    employeeIds: readonly string[];
  },
): Promise<Map<string, ClockEvent[]>> {
  const byEmployee = new Map<string, ClockEvent[]>();
  if (query.employeeIds.length === 0) return byEmployee;
  const newYear = brusselsLocalToInstant(
    `${query.periodFrom.slice(0, 4)}-01-01`,
    "00:00",
  );
  const yearStart = new Date(newYear.getTime() - LOOKAHEAD_MS).toISOString();

  const byId = new Map<string, ClockEvent>();
  for (const ids of chunks(query.employeeIds, IN_CHUNK)) {
    const rows = await allPages<EventRow>("clock_events", (from, to) =>
      supabase
        .from("clock_events")
        .select(EVENT_COLUMNS)
        .eq("organization_id", query.organizationId)
        .in("employee_id", ids)
        .gte("occurred_at", yearStart)
        .lt("occurred_at", query.windowEnd)
        .order("occurred_at")
        .order("id")
        .range(from, to),
    );
    const corrections = await allPages<EventRow>("clock_events", (from, to) =>
      supabase
        .from("clock_events")
        .select(EVENT_COLUMNS)
        .eq("organization_id", query.organizationId)
        .in("employee_id", ids)
        .eq("source", "correction")
        .gte("server_at", yearStart)
        .order("server_at")
        .order("id")
        .range(from, to),
    );
    for (const row of [...rows, ...corrections]) byId.set(row.id, toClockEvent(row));
  }
  for (const event of byId.values()) {
    const list = byEmployee.get(event.employeeId) ?? [];
    list.push(event);
    byEmployee.set(event.employeeId, list);
  }
  return byEmployee;
}
