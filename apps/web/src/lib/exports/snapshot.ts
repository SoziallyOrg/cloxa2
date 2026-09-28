/**
 * Build a `cloxa.export.v1` snapshot from raw clock events and planned
 * blocks. Pure: the loader does the I/O, `@cloxa/domain` does the shift math,
 * this module only groups, filters and names things.
 */
import {
  brusselsDayKey,
  deriveShifts,
  deviationFromSchedule,
  effectiveEvents,
  type ClockEvent,
  type PlannedBlock,
  type Shift,
} from "@cloxa/domain";

import { brusselsIsoLocal } from "./brussels";
import {
  EXPORT_FORMAT_VERSION,
  EXPORT_TIMEZONE,
  type ExportContent,
  type ExportRow,
  type ExportShift,
} from "./content";

export interface SnapshotEmployee {
  readonly id: string;
  readonly code: string | null;
  readonly name: string;
}

export interface SnapshotPlannedBlock extends PlannedBlock {
  readonly employeeId: string;
  /** Brussels day the block is planned on (an overnight block keeps its start day). */
  readonly day: string;
}

export interface SnapshotInput {
  readonly organizationId: string;
  readonly createdBy: string;
  readonly generatedAt: number;
  readonly period: { readonly from: string; readonly to: string };
  /** Null: every site. Otherwise only shifts that started at one of these. */
  readonly siteIds: readonly string[] | null;
  readonly siteNames: ReadonlyMap<string, string>;
  /** Everyone who may get a row: assigned to a selected site or clocked at one. */
  readonly employees: readonly SnapshotEmployee[];
  /** All fetched events of those employees, superseded and void ones included. */
  readonly events: readonly ClockEvent[];
  readonly planned: readonly SnapshotPlannedBlock[];
}

function compare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Instants a correction touched: the events it replaced or removed. */
function supersededInstants(events: readonly ClockEvent[]): number[] {
  const byId = new Map(events.map((event) => [event.id, event]));
  const instants: number[] = [];
  for (const event of events) {
    if (event.supersedesEventId === undefined) continue;
    const target = byId.get(event.supersedesEventId);
    if (target !== undefined) instants.push(target.occurredAt);
  }
  return instants;
}

function toExportShift(
  shift: Shift,
  siteId: string,
  siteNames: ReadonlyMap<string, string>,
  touched: readonly number[],
): ExportShift {
  const referenceEnd = shift.start + shift.grossMs;
  const edited =
    shift.edited ||
    touched.some((instant) => instant >= shift.start && instant <= referenceEnd);
  return {
    site_id: siteId,
    site_name: siteNames.get(siteId) ?? "",
    start_utc: new Date(shift.start).toISOString(),
    end_utc: shift.end === null ? null : new Date(shift.end).toISOString(),
    start_local: brusselsIsoLocal(shift.start),
    end_local: shift.end === null ? null : brusselsIsoLocal(shift.end),
    break_ms: shift.breakMs,
    gross_ms: shift.grossMs,
    net_ms: shift.netMs,
    edited,
    open: shift.open,
    overnight: shift.overnight,
  };
}

interface DayBucket {
  shifts: Shift[];
  exportShifts: ExportShift[];
  planned: PlannedBlock[];
}

export function buildExportContent(input: SnapshotInput): ExportContent {
  const { period } = input;
  const siteFilter = input.siteIds === null ? null : new Set(input.siteIds);
  const inPeriod = (day: string) => day >= period.from && day <= period.to;

  const eventsByEmployee = new Map<string, ClockEvent[]>();
  for (const event of input.events) {
    const list = eventsByEmployee.get(event.employeeId) ?? [];
    list.push(event);
    eventsByEmployee.set(event.employeeId, list);
  }

  const plannedByEmployee = new Map<string, SnapshotPlannedBlock[]>();
  for (const block of input.planned) {
    const list = plannedByEmployee.get(block.employeeId) ?? [];
    list.push(block);
    plannedByEmployee.set(block.employeeId, list);
  }

  const employees = [...input.employees].sort(
    (a, b) => compare(a.name, b.name) || compare(a.id, b.id),
  );

  const rows: ExportRow[] = [];

  for (const employee of employees) {
    const days = new Map<string, DayBucket>();
    const bucket = (day: string) => {
      let entry = days.get(day);
      if (entry === undefined) {
        entry = { shifts: [], exportShifts: [], planned: [] };
        days.set(day, entry);
      }
      return entry;
    };

    const raw = eventsByEmployee.get(employee.id) ?? [];
    const effective = effectiveEvents(raw);
    const touched = supersededInstants(raw);
    const clockIns = effective.filter((event) => event.type === "clock_in");

    for (const shift of deriveShifts(effective)) {
      const day = brusselsDayKey(shift.start);
      if (!inPeriod(day)) continue;
      const clockIn = clockIns.find((event) => event.occurredAt === shift.start);
      if (clockIn === undefined) continue;
      if (siteFilter !== null && !siteFilter.has(clockIn.siteId)) continue;
      const entry = bucket(day);
      entry.shifts.push(shift);
      entry.exportShifts.push(
        toExportShift(shift, clockIn.siteId, input.siteNames, touched),
      );
    }

    for (const block of plannedByEmployee.get(employee.id) ?? []) {
      if (!inPeriod(block.day)) continue;
      bucket(block.day).planned.push({ start: block.start, end: block.end });
    }

    for (const day of [...days.keys()].sort(compare)) {
      const entry = days.get(day);
      if (entry === undefined) continue;
      const deviation = deviationFromSchedule(entry.shifts, entry.planned);
      if (entry.shifts.length === 0 && deviation.plannedMs === 0) continue;
      rows.push({
        day,
        employee_id: employee.id,
        employee_code: employee.code,
        employee_name: employee.name,
        shifts: entry.exportShifts,
        planned_ms: deviation.plannedMs,
        worked_net_ms: deviation.workedNetMs,
        deviation_ms: deviation.deltaMs,
        edited: entry.exportShifts.some((shift) => shift.edited),
      });
    }
  }

  return {
    format_version: EXPORT_FORMAT_VERSION,
    organization_id: input.organizationId,
    created_by: input.createdBy,
    generated_at: new Date(input.generatedAt).toISOString(),
    period: { from: period.from, to: period.to, timezone: EXPORT_TIMEZONE },
    site_ids: input.siteIds === null ? null : [...input.siteIds],
    rows,
  };
}
