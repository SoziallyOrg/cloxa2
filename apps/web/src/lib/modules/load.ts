import "server-only";

import { scheduleFor, type CloxaClient } from "@cloxa/db";
import {
  brusselsDayKey,
  deriveShifts,
  effectiveEvents,
  type Shift,
} from "@cloxa/domain";
import { brusselsLocalToInstant } from "@cloxa/i18n";
import {
  enabledModules,
  isModuleId,
  type EnabledModule,
  type ModuleId,
  type Period,
  type PlannedDayBlock,
} from "@cloxa/modules";

import { CLOCK_EVENT_COLUMNS, clockEventFromRow, type ClockEventRow } from "./events";

/** PostgREST returns at most this many rows per request (supabase/config.toml max_rows). */
const PAGE = 1000;
const MAX_PAGES = 20;
/** `rpc_schedule_for` takes at most 93 days per call. */
const SCHEDULE_CHUNK_DAYS = 90;
const DAY_MS = 24 * 3600 * 1000;

/** The organization's enabled modules, in registry order; none when the read fails. */
export async function loadEnabledModules(
  supabase: CloxaClient,
  organizationId: string,
): Promise<EnabledModule[]> {
  const { data, error } = await supabase
    .from("org_modules")
    .select("module, enabled, config")
    .eq("organization_id", organizationId);
  if (error) throw new Error(`org_modules_unavailable:${error.code}`);
  return enabledModules(data);
}

/** Every `org_modules` row of the organization, switched off ones included. */
export async function loadOrgModuleRows(
  supabase: CloxaClient,
  organizationId: string,
): Promise<Map<ModuleId, { enabled: boolean; config: unknown }>> {
  const { data, error } = await supabase
    .from("org_modules")
    .select("module, enabled, config")
    .eq("organization_id", organizationId);
  if (error) throw new Error(`org_modules_unavailable:${error.code}`);
  const rows = new Map<ModuleId, { enabled: boolean; config: unknown }>();
  for (const row of data) {
    if (isModuleId(row.module))
      rows.set(row.module, { enabled: row.enabled, config: row.config });
  }
  return rows;
}

/** One employee's saved module data, per module. */
export async function loadModuleData(
  supabase: CloxaClient,
  employeeId: string,
): Promise<Map<ModuleId, unknown>> {
  const { data, error } = await supabase
    .from("employee_module_data")
    .select("module, data")
    .eq("employee_id", employeeId);
  if (error) throw new Error(`employee_module_data_unavailable:${error.code}`);
  const byModule = new Map<ModuleId, unknown>();
  for (const row of data) {
    if (isModuleId(row.module)) byModule.set(row.module, row.data);
  }
  return byModule;
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The last day of the quarter `day` falls in. */
function quarterEnd(day: string): string {
  const year = Number(day.slice(0, 4));
  const quarter = Math.floor((Number(day.slice(5, 7)) - 1) / 3);
  return new Date(Date.UTC(year, quarter * 3 + 3, 0)).toISOString().slice(0, 10);
}

export interface ModuleFacts {
  readonly shifts: readonly Shift[];
  readonly planned: readonly PlannedDayBlock[];
  readonly period: Period;
}

/**
 * One employee's facts for the module counters: this calendar year's shifts
 * up to now, and the planning from 1 January to the end of this quarter (the
 * student quarters count the whole quarter). Read as the caller, through RLS.
 */
export async function loadYearFacts(
  supabase: CloxaClient,
  employeeId: string,
  now: number,
): Promise<ModuleFacts> {
  const today = brusselsDayKey(now);
  const from = `${today.slice(0, 4)}-01-01`;
  const windowStart = brusselsLocalToInstant(from, "00:00").getTime() - DAY_MS;

  const rows: ClockEventRow[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await supabase
      .from("clock_events")
      .select(CLOCK_EVENT_COLUMNS)
      .eq("employee_id", employeeId)
      .gte("occurred_at", new Date(windowStart).toISOString())
      .order("occurred_at")
      .order("id")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`clock_events_unavailable:${error.code}`);
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  const shifts = deriveShifts(effectiveEvents(rows.map(clockEventFromRow)));

  const last = quarterEnd(today);
  const planned: PlannedDayBlock[] = [];
  const chunks: { from: string; to: string }[] = [];
  for (let start = from; start <= last; start = addDays(start, SCHEDULE_CHUNK_DAYS)) {
    const end = addDays(start, SCHEDULE_CHUNK_DAYS - 1);
    chunks.push({ from: start, to: end < last ? end : last });
  }
  const results = await Promise.all(
    chunks.map((chunk) => scheduleFor(supabase, { employeeId, ...chunk })),
  );
  for (const result of results) {
    for (const row of result) {
      planned.push({
        day: row.day,
        start: Date.parse(row.start_at),
        end: Date.parse(row.end_at),
      });
    }
  }

  return { shifts, planned, period: { from, to: today, now } };
}
