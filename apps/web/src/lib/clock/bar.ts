import "server-only";

import {
  deriveShifts,
  effectiveEvents,
  type ClockEvent,
  type ClockEventSource,
  type ClockEventType,
  type Shift,
  type ShiftState,
} from "@cloxa/domain";
import { myStatus } from "@cloxa/db";

import { createClient } from "@/lib/supabase/server";

import { nowMs } from "./now";
import { readChosenSiteId } from "./site-cookie";

const RECENT_EVENTS_WINDOW_MS = 3 * 24 * 3600 * 1000;

/** Everything the clock bar needs, plain data for the client. */
export interface ClockBarData {
  employeeId: string;
  siteId: string;
  state: Exclude<ShiftState, "off">;
  since: number;
  now: number;
  /** The open shift (its breaks give the running time). */
  openShifts: readonly Shift[];
}

/**
 * The clock bar's data, read exactly as the Klok screen reads it (`my_status`,
 * the employee's site assignment and recent events, under RLS). `null` when
 * the person is not clocked in, or no site is known yet (Klok asks for it).
 * A failed read hides the bar rather than breaking the page around it.
 */
export async function loadClockBar(employeeId: string): Promise<ClockBarData | null> {
  try {
    const supabase = await createClient();
    const statusRows = await myStatus(supabase);
    const status = statusRows[0];
    const state = status?.state as ShiftState | undefined;
    if (
      (state !== "working" && state !== "on_break") ||
      status?.open_shift_started_at == null
    ) {
      return null;
    }
    const since = Date.parse(status.open_shift_started_at);
    const now = nowMs();

    const { data: assignments, error: assignmentsError } = await supabase
      .from("site_assignments")
      .select("site_id")
      .eq("employee_id", employeeId);
    if (assignmentsError) return null;
    const siteIds = assignments.map((row) => row.site_id);
    if (siteIds.length === 0) return null;

    const { data: sites, error: sitesError } = await supabase
      .from("sites")
      .select("id, name")
      .in("id", siteIds)
      .eq("active", true)
      .order("name");
    if (sitesError || sites.length === 0) return null;

    let siteId = sites.length === 1 ? sites[0]!.id : null;
    if (siteId === null) {
      const chosen = await readChosenSiteId();
      if (chosen !== null && sites.some((site) => site.id === chosen)) siteId = chosen;
    }
    if (siteId === null) return null;

    const { data: eventRows, error: eventsError } = await supabase
      .from("clock_events")
      .select(
        "id, type, occurred_at, employee_id, site_id, source, supersedes_event_id, correction_id, offline",
      )
      .eq("employee_id", employeeId)
      .gte("occurred_at", new Date(now - RECENT_EVENTS_WINDOW_MS).toISOString())
      .order("occurred_at");
    if (eventsError) return null;

    const events: ClockEvent[] = eventRows.map((row) => ({
      id: row.id,
      type: row.type as ClockEventType,
      occurredAt: Date.parse(row.occurred_at),
      employeeId: row.employee_id,
      siteId: row.site_id,
      source: row.source as ClockEventSource,
      ...(row.supersedes_event_id
        ? { supersedesEventId: row.supersedes_event_id }
        : {}),
      ...(row.correction_id ? { correctionId: row.correction_id } : {}),
      ...(row.offline ? { offline: true } : {}),
    }));
    const openShifts = deriveShifts(effectiveEvents(events)).filter(
      (shift) => shift.open,
    );

    return { employeeId, siteId, state, since, now, openShifts };
  } catch {
    return null;
  }
}
