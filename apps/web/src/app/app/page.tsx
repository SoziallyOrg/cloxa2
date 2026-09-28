import {
  brusselsDayKey,
  deriveShifts,
  effectiveEvents,
  type ClockEvent,
  type ClockEventSource,
  type ClockEventType,
  type ShiftState,
} from "@cloxa/domain";
import { myStatus } from "@cloxa/db";
import { t } from "@cloxa/i18n";

import { EmployeeHomeContainer } from "@/components/employee/EmployeeHomeContainer";
import { SitePicker } from "@/components/clock/SitePicker";
import { requireEmployeeArea } from "@/lib/auth/context";
import { nowMs } from "@/lib/clock/now";
import { readChosenSiteId } from "@/lib/clock/site-cookie";
import { createClient } from "@/lib/supabase/server";

import { chooseSiteAction } from "./actions";

const RECENT_EVENTS_WINDOW_MS = 3 * 24 * 3600 * 1000;

export default async function EmployeeAppPage() {
  // Layouts don't re-run on client navigation, so every page checks too.
  const context = await requireEmployeeArea();
  const supabase = await createClient();
  const now = nowMs();

  const { data: employee, error: employeeError } = await supabase
    .from("employees")
    .select("display_name")
    .eq("id", context.employeeId)
    .single();
  if (employeeError) throw new Error(`employee_unavailable:${employeeError.code}`);
  const firstName =
    employee.display_name.trim().split(/\s+/)[0] ?? employee.display_name;

  const { data: assignments, error: assignmentsError } = await supabase
    .from("site_assignments")
    .select("site_id")
    .eq("employee_id", context.employeeId);
  if (assignmentsError) {
    throw new Error(`site_assignments_unavailable:${assignmentsError.code}`);
  }
  const siteIds = assignments.map((row) => row.site_id);

  const { data: sites, error: sitesError } =
    siteIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("sites")
          .select("id, name")
          .in("id", siteIds)
          .eq("active", true)
          .order("name");
  if (sitesError) throw new Error(`sites_unavailable:${sitesError.code}`);

  if (sites.length === 0) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-6">
        <p className="text-lg">{t("sitePicker.none")}</p>
      </main>
    );
  }

  let siteId = sites.length === 1 ? sites[0]!.id : null;
  if (siteId === null) {
    const chosen = await readChosenSiteId();
    if (chosen !== null && sites.some((site) => site.id === chosen)) {
      siteId = chosen;
    }
  }

  if (siteId === null) {
    return <SitePicker sites={sites} action={chooseSiteAction} />;
  }

  const [statusRows, eventsResult] = await Promise.all([
    myStatus(supabase),
    supabase
      .from("clock_events")
      .select(
        "id, type, occurred_at, employee_id, site_id, source, supersedes_event_id, correction_id",
      )
      .eq("employee_id", context.employeeId)
      .gte("occurred_at", new Date(now - RECENT_EVENTS_WINDOW_MS).toISOString())
      .order("occurred_at"),
  ]);
  const { data: eventRows, error: eventsError } = eventsResult;
  if (eventsError) throw new Error(`clock_events_unavailable:${eventsError.code}`);

  const status = statusRows[0];
  const initialShiftState: ShiftState =
    (status?.state as ShiftState | undefined) ?? "off";
  const initialSince =
    status?.open_shift_started_at != null
      ? Date.parse(status.open_shift_started_at)
      : null;

  const events: ClockEvent[] = eventRows.map((row) => ({
    id: row.id,
    type: row.type as ClockEventType,
    occurredAt: Date.parse(row.occurred_at),
    employeeId: row.employee_id,
    siteId: row.site_id,
    source: row.source as ClockEventSource,
    ...(row.supersedes_event_id ? { supersedesEventId: row.supersedes_event_id } : {}),
    ...(row.correction_id ? { correctionId: row.correction_id } : {}),
  }));
  const shifts = deriveShifts(effectiveEvents(events));
  const todayKey = brusselsDayKey(now);
  const todayShifts = shifts.filter(
    (shift) =>
      shift.open ||
      brusselsDayKey(shift.start) === todayKey ||
      (shift.end !== null && brusselsDayKey(shift.end) === todayKey),
  );

  return (
    <EmployeeHomeContainer
      firstName={firstName}
      initialShiftState={initialShiftState}
      initialSince={initialSince}
      initialNow={now}
      todayShifts={todayShifts}
      activeNav="clock"
      siteId={siteId}
    />
  );
}
