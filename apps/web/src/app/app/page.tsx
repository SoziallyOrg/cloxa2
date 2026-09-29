import {
  brusselsDayKey,
  deriveShifts,
  effectiveEvents,
  type ClockEvent,
  type ClockEventSource,
  type ClockEventType,
  type ShiftState,
} from "@cloxa/domain";
import { myStatus, scheduleFor } from "@cloxa/db";
import { formatBrusselsTime, t } from "@cloxa/i18n";

import { MapPin } from "lucide-react";

import { Logo } from "@/components/brand/Logo";
import type { PlannedDay } from "@/components/clock/clock-face";
import { AccountButton } from "@/components/employee/Account";
import { EmployeeHomeContainer } from "@/components/employee/EmployeeHomeContainer";
import { SitePicker } from "@/components/clock/SitePicker";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageTransition } from "@/components/ui/PageTransition";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { previewHold } from "@/lib/preview";
import { requireEmployeeArea } from "@/lib/auth/context";
import { nowMs } from "@/lib/clock/now";
import { readChosenSiteId } from "@/lib/clock/site-cookie";
import { loadEnabledModules } from "@/lib/modules/load";
import { nightLookbackStart } from "@/lib/manage/timeline";
import { blocksForOpenShift } from "@/lib/schedule/open-shift";
import { createClient } from "@/lib/supabase/server";

import { chooseSiteAction } from "./actions";

const RECENT_EVENTS_WINDOW_MS = 3 * 24 * 3600 * 1000;

/**
 * Klok is the hero page, so no large title: on phones the logotype on the
 * left and the name (the account sheet) on the right. Desktop has both in
 * the sidebar.
 */
function KlokFrame({ children }: { children: React.ReactNode }) {
  return (
    <PageTransition className="flex flex-1 flex-col">
      <header className="box-content flex h-nav-bar items-center justify-between gap-4 px-gutter pt-[env(safe-area-inset-top)] md:hidden">
        <Logo />
        <AccountButton placement="header" />
      </header>
      <PullToRefresh className="flex flex-1 flex-col">{children}</PullToRefresh>
    </PageTransition>
  );
}

export default async function EmployeeAppPage() {
  // Layouts don't re-run on client navigation, so every page checks too.
  const context = await requireEmployeeArea();
  await previewHold();
  const supabase = await createClient();
  const now = nowMs();

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
      <KlokFrame>
        <h1 className="sr-only">{t("app.heading")}</h1>
        <div className="flex flex-1 flex-col justify-center">
          <EmptyState
            icon={MapPin}
            title={t("sitePicker.noneTitle")}
            body={t("sitePicker.none")}
          />
        </div>
      </KlokFrame>
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
    return (
      <PageTransition>
        <SitePicker sites={sites} action={chooseSiteAction} />
      </PageTransition>
    );
  }

  const [statusRows, eventsResult, askWorkLocation] = await Promise.all([
    myStatus(supabase),
    supabase
      .from("clock_events")
      .select(
        "id, type, occurred_at, employee_id, site_id, source, supersedes_event_id, correction_id, offline",
      )
      .eq("employee_id", context.employeeId)
      .gte("occurred_at", new Date(now - RECENT_EVENTS_WINDOW_MS).toISOString())
      .order("occurred_at"),
    // Telework asks where at "Start werk". A module never blocks clocking:
    // when this read fails, the question is simply left out.
    loadEnabledModules(supabase, context.membership.organizationId).then(
      (enabled) => enabled.some(({ module }) => module.id === "telework"),
      () => false,
    ),
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
    ...(row.offline ? { offline: true } : {}),
  }));
  const shifts = deriveShifts(effectiveEvents(events));
  const todayKey = brusselsDayKey(now);
  const todayShifts = shifts.filter(
    (shift) =>
      shift.open ||
      brusselsDayKey(shift.start) === todayKey ||
      (shift.end !== null && brusselsDayKey(shift.end) === todayKey),
  );

  // From yesterday on: a night shift started 21:30 belongs to yesterday's
  // block (21:30–06:00), and that is the plan its progress track measures.
  const scheduleRows = await scheduleFor(supabase, {
    employeeId: context.employeeId,
    from: brusselsDayKey(nightLookbackStart(todayKey)),
    to: todayKey,
  });
  const scheduleToday =
    initialSince === null
      ? scheduleRows.filter(
          (row) => brusselsDayKey(Date.parse(row.start_at)) === todayKey,
        )
      : blocksForOpenShift(
          initialSince,
          scheduleRows.map((row) => ({
            ...row,
            start: Date.parse(row.start_at),
            end: Date.parse(row.end_at),
          })),
        );
  const planned: PlannedDay | null =
    scheduleToday.length === 0
      ? null
      : {
          start: Math.min(...scheduleToday.map((row) => Date.parse(row.start_at))),
          end: Math.max(...scheduleToday.map((row) => Date.parse(row.end_at))),
          netMs: scheduleToday.reduce(
            (sum, row) => sum + Date.parse(row.end_at) - Date.parse(row.start_at),
            0,
          ),
          range: scheduleToday
            .map(
              (row) =>
                `${formatBrusselsTime(new Date(row.start_at))}–${formatBrusselsTime(new Date(row.end_at))}`,
            )
            .join(", "),
        };

  return (
    <KlokFrame>
      <EmployeeHomeContainer
        employeeId={context.employeeId}
        initialShiftState={initialShiftState}
        initialSince={initialSince}
        initialNow={now}
        todayShifts={todayShifts}
        planned={planned}
        siteId={siteId}
        askWorkLocation={askWorkLocation}
      />
    </KlokFrame>
  );
}
