import { scheduleFor } from "@cloxa/db";
import {
  brusselsDayKey,
  deriveShifts,
  effectiveEvents,
  type ClockEvent,
  type ClockEventSource,
  type ClockEventType,
} from "@cloxa/domain";
import { formatBrusselsTime, t } from "@cloxa/i18n";

import { AutoRefresh } from "@/components/manage/AutoRefresh";
import { ManageShell } from "@/components/manage/ManageShell";
import { SiteFilter } from "@/components/manage/SiteFilter";
import {
  TodayBoard,
  type TodayBoardAttentionItem,
  type TodayBoardPerson,
} from "@/components/manage/TodayBoard";
import type { StatusTone } from "@/components/ui/StatusBadge";
import { Heading } from "@/components/ui/Heading";
import { requireManager } from "@/lib/auth/context";
import { nowMs } from "@/lib/clock/now";
import {
  buildAttention,
  type OpenShiftStatus,
  type ScheduledStart,
} from "@/lib/manage/attention";
import { createClient } from "@/lib/supabase/server";

// Wide enough to still catch a shift forgotten open from the previous
// Brussels day, without loading unbounded history.
const EVENTS_LOOKBACK_MS = 3 * 24 * 3600 * 1000;

export default async function ManagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Layouts don't re-run on client navigation, so every page checks too.
  const context = await requireManager();
  const supabase = await createClient();
  const now = nowMs();
  const todayKey = brusselsDayKey(now);
  const params = await searchParams;
  const siteRaw = Array.isArray(params.site) ? params.site[0] : params.site;

  const { data: siteRows, error: sitesError } = await supabase
    .from("sites")
    .select("id, name")
    .eq("active", true)
    .order("name");
  if (sitesError) throw new Error(`sites_unavailable:${sitesError.code}`);

  const selectedSiteId =
    siteRaw && siteRows.some((site) => site.id === siteRaw) ? siteRaw : null;

  const { data: employeeRows, error: employeesError } = await supabase
    .from("employees")
    .select("id, display_name")
    .eq("active", true)
    .order("display_name");
  if (employeesError) throw new Error(`employees_unavailable:${employeesError.code}`);

  const { data: assignmentRows, error: assignmentsError } = await supabase
    .from("site_assignments")
    .select("employee_id, site_id")
    .not("employee_id", "is", null);
  if (assignmentsError) {
    throw new Error(`site_assignments_unavailable:${assignmentsError.code}`);
  }
  const sitesByEmployee = new Map<string, Set<string>>();
  for (const row of assignmentRows) {
    if (row.employee_id === null) continue;
    const set = sitesByEmployee.get(row.employee_id) ?? new Set<string>();
    set.add(row.site_id);
    sitesByEmployee.set(row.employee_id, set);
  }

  const visibleEmployees = selectedSiteId
    ? employeeRows.filter((employee) =>
        sitesByEmployee.get(employee.id)?.has(selectedSiteId),
      )
    : employeeRows;

  const { count: pendingCount, error: pendingError } = await supabase
    .from("correction_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (pendingError)
    throw new Error(`correction_requests_unavailable:${pendingError.code}`);
  const pendingCorrectionsCount = pendingCount ?? 0;

  const employeeIds = visibleEmployees.map((employee) => employee.id);
  const { data: eventRows, error: eventsError } =
    employeeIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("clock_events")
          .select(
            "id, type, occurred_at, employee_id, site_id, source, supersedes_event_id, correction_id",
          )
          .in("employee_id", employeeIds)
          .gte("occurred_at", new Date(now - EVENTS_LOOKBACK_MS).toISOString())
          .order("occurred_at");
  if (eventsError) throw new Error(`clock_events_unavailable:${eventsError.code}`);

  const eventsByEmployee = new Map<string, ClockEvent[]>();
  for (const row of eventRows) {
    const event: ClockEvent = {
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
    };
    const list = eventsByEmployee.get(row.employee_id) ?? [];
    list.push(event);
    eventsByEmployee.set(row.employee_id, list);
  }

  const scheduleResults = await Promise.all(
    visibleEmployees.map((employee) =>
      scheduleFor(supabase, { employeeId: employee.id, from: todayKey, to: todayKey }),
    ),
  );
  const scheduleByEmployee = new Map(
    visibleEmployees.map((employee, index) => [employee.id, scheduleResults[index]!]),
  );

  const openShifts: OpenShiftStatus[] = [];
  const scheduledStarts: ScheduledStart[] = [];
  const clockedInEmployeeIds = new Set<string>();
  const people: TodayBoardPerson[] = [];
  let workingCount = 0;
  let onBreakCount = 0;

  for (const employee of visibleEmployees) {
    const shifts = deriveShifts(
      effectiveEvents(eventsByEmployee.get(employee.id) ?? []),
    );
    const last = shifts.at(-1) ?? null;
    const hasShiftToday = shifts.some(
      (shift) => brusselsDayKey(shift.start) === todayKey,
    );
    if (hasShiftToday) clockedInEmployeeIds.add(employee.id);

    const scheduleToday = scheduleByEmployee.get(employee.id) ?? [];
    const firstBlock = scheduleToday[0];
    if (firstBlock) {
      scheduledStarts.push({
        employeeId: employee.id,
        employeeName: employee.display_name,
        startAt: Date.parse(firstBlock.start_at),
      });
    }

    let tone: StatusTone = "off";
    let statusLabelKey:
      | "manage.statusWorkingLabel"
      | "manage.statusBreakLabel"
      | "manage.statusOffLabel" = "manage.statusOffLabel";
    let sinceLabel: string | null = null;

    if (last && last.open) {
      openShifts.push({
        employeeId: employee.id,
        employeeName: employee.display_name,
        startedAt: last.start,
        openBreakStartedAt: last.openBreak ? (last.breaks.at(-1)?.start ?? null) : null,
      });

      if (last.openBreak) {
        onBreakCount += 1;
        tone = "break";
        statusLabelKey = "manage.statusBreakLabel";
        const breakStart = last.breaks.at(-1)?.start ?? last.start;
        sinceLabel = t("manage.sinceLabel", {
          time: formatBrusselsTime(new Date(breakStart)),
        });
      } else {
        workingCount += 1;
        tone = "working";
        statusLabelKey = "manage.statusWorkingLabel";
        sinceLabel = t("manage.sinceLabel", {
          time: formatBrusselsTime(new Date(last.start)),
        });
      }
    }

    people.push({
      id: employee.id,
      name: employee.display_name,
      tone,
      statusLabel: t(statusLabelKey),
      sinceLabel,
    });
  }

  const notStartedCount = visibleEmployees.filter(
    (employee) =>
      scheduleByEmployee.get(employee.id)?.length &&
      !clockedInEmployeeIds.has(employee.id),
  ).length;

  const attentionItems = buildAttention({
    openShifts,
    scheduledStarts,
    clockedInEmployeeIds,
    pendingCorrectionsCount,
    now,
  });

  const ATTENTION_LABEL_KEY = {
    forgotClockOut: "manage.forgotClockOut",
    longBreak: "manage.longBreak",
    notStarted: "manage.notStarted",
    pendingQuestions: "manage.pendingQuestions",
  } as const;

  const attention: TodayBoardAttentionItem[] = attentionItems.map((item) => ({
    id: item.id,
    name: item.employeeName,
    reason:
      item.reason === "pendingQuestions"
        ? t(ATTENTION_LABEL_KEY[item.reason], { count: item.count ?? 0 })
        : t(ATTENTION_LABEL_KEY[item.reason]),
    href:
      item.reason === "pendingQuestions"
        ? "/manage/vragen"
        : `/manage/medewerker/${item.employeeId}`,
  }));

  const deviationEmployees = new Set(
    attentionItems
      .filter((item) => item.reason === "forgotClockOut" || item.reason === "longBreak")
      .map((item) => item.employeeId),
  );

  return (
    <ManageShell
      active="today"
      pendingQuestionsCount={pendingCorrectionsCount}
      showSwitchToEmployee={context.employeeId !== null}
    >
      <AutoRefresh />
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Heading level={1}>{t("manage.todayHeading")}</Heading>
          {siteRows.length > 1 ? (
            <SiteFilter sites={siteRows} selectedSiteId={selectedSiteId} />
          ) : null}
        </div>
        <TodayBoard
          counters={{
            working: workingCount,
            onBreak: onBreakCount,
            notStarted: notStartedCount,
            deviations: deviationEmployees.size,
          }}
          people={people}
          attention={attention}
        />
      </div>
    </ManageShell>
  );
}
