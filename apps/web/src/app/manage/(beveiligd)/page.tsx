import { scheduleFor } from "@cloxa/db";
import {
  brusselsDayKey,
  deriveShifts,
  effectiveEvents,
  type ClockEvent,
  type ClockEventSource,
  type ClockEventType,
} from "@cloxa/domain";
import {
  brusselsLocalToInstant,
  formatBrusselsLongDay,
  formatBrusselsShortDate,
  formatBrusselsTime,
  t,
} from "@cloxa/i18n";

import { formatDurationMs } from "@/components/clock/format";
import { brusselsWeekRange } from "@/components/clock/week-total";
import { AutoRefresh } from "@/components/manage/AutoRefresh";
import { ManageShell } from "@/components/manage/ManageShell";
import { SiteFilter } from "@/components/manage/SiteFilter";
import {
  TeamTimeline,
  type TeamTimelinePerson,
} from "@/components/manage/TeamTimeline";
import { GroupedList, ListLinkRow } from "@/components/ui/GroupedList";
import { NumbersRow } from "@/components/ui/NumbersRow";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireManager } from "@/lib/auth/context";
import { nowMs } from "@/lib/clock/now";
import {
  buildAttention,
  type OfflineEvent,
  type OpenShiftStatus,
  type ScheduledStart,
} from "@/lib/manage/attention";
import {
  netUntil,
  nowPct,
  positionPct,
  TIMELINE_AXIS_HOURS,
  TIMELINE_START_HOUR,
  timelineRow,
  timelineWindow,
} from "@/lib/manage/timeline";
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
  await requireManager();
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
            "id, type, occurred_at, employee_id, site_id, source, supersedes_event_id, correction_id, offline",
          )
          .in("employee_id", employeeIds)
          .gte("occurred_at", new Date(now - EVENTS_LOOKBACK_MS).toISOString())
          .order("occurred_at");
  if (eventsError) throw new Error(`clock_events_unavailable:${eventsError.code}`);

  // This week's offline events by sync time: an event backdated up to 72
  // hours still counts on the day it arrived (ADR 006).
  const { data: offlineRows, error: offlineError } =
    employeeIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("clock_events")
          .select("employee_id, occurred_at, server_at")
          .eq("offline", true)
          .in("employee_id", employeeIds)
          .gte("server_at", new Date(brusselsWeekRange(now).start).toISOString())
          .order("server_at");
  if (offlineError) throw new Error(`clock_events_unavailable:${offlineError.code}`);
  const employeeNames = new Map(
    visibleEmployees.map((employee) => [employee.id, employee.display_name]),
  );
  const offlineEvents: OfflineEvent[] = offlineRows.map((row) => ({
    employeeId: row.employee_id,
    employeeName: employeeNames.get(row.employee_id) ?? "",
    occurredAt: Date.parse(row.occurred_at),
    serverAt: Date.parse(row.server_at),
  }));

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
      ...(row.offline ? { offline: true } : {}),
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

  const dayWindow = timelineWindow(todayKey);
  const midnight = brusselsLocalToInstant(todayKey, "00:00").getTime();
  const openShifts: OpenShiftStatus[] = [];
  const scheduledStarts: ScheduledStart[] = [];
  const clockedInEmployeeIds = new Set<string>();
  const rows: (Omit<TeamTimelinePerson, "notes" | "fixHref"> & {
    staleOpenSince: number | null;
  })[] = [];
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

    if (last && last.open) {
      openShifts.push({
        employeeId: employee.id,
        employeeName: employee.display_name,
        startedAt: last.start,
        openBreakStartedAt: last.openBreak ? (last.breaks.at(-1)?.start ?? null) : null,
      });
    }

    // Left open since an earlier day: not work done today, so it is neither
    // drawn nor counted as "aan het werk". It shows as a note instead.
    const staleOpen = last !== null && last.open && last.start < midnight;
    const drawn = shifts.filter(
      (shift) =>
        !(shift.open && shift.start < midnight) &&
        shift.start < dayWindow.end &&
        (shift.end ?? now) > dayWindow.start,
    );
    const workedToday = shifts.filter(
      (shift) => brusselsDayKey(shift.start) === todayKey,
    );
    const netMs = workedToday.reduce((total, shift) => total + netUntil(shift, now), 0);
    const lastToday = workedToday.at(-1);

    let status: string;
    if (last && last.open && !staleOpen && last.openBreak) {
      onBreakCount += 1;
      status = t("manage.statusBreakSince", {
        time: formatBrusselsTime(new Date(last.breaks.at(-1)?.start ?? last.start)),
      });
    } else if (last && last.open && !staleOpen) {
      workingCount += 1;
      status = t("manage.sinceLabel", { time: formatBrusselsTime(new Date(last.start)) });
    } else if (staleOpen) {
      status = "";
    } else if (lastToday && lastToday.end !== null) {
      status = t("manage.statusStoppedAt", {
        time: formatBrusselsTime(new Date(lastToday.end)),
      });
    } else if (firstBlock) {
      status = t("manage.statusStartAt", {
        time: formatBrusselsTime(new Date(firstBlock.start_at)),
      });
    } else {
      status = t("manage.statusFree");
    }

    rows.push({
      id: employee.id,
      name: employee.display_name,
      status,
      net: workedToday.length > 0 ? formatDurationMs(netMs) : null,
      track: timelineRow({
        shifts: drawn,
        planned: scheduleToday.map((block) => ({
          start: Date.parse(block.start_at),
          end: Date.parse(block.end_at),
        })),
        now,
        window: dayWindow,
      }),
      staleOpenSince: staleOpen ? last.start : null,
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
    offlineEvents,
    pendingCorrectionsCount,
    now,
  });

  // How late today's offline actions arrived, per person ("2 u later verstuurd").
  const offlineLateMs = new Map<string, number>();
  for (const event of offlineEvents) {
    if (brusselsDayKey(event.serverAt) !== todayKey) continue;
    offlineLateMs.set(
      event.employeeId,
      Math.max(event.serverAt - event.occurredAt, offlineLateMs.get(event.employeeId) ?? 0),
    );
  }

  const yesterdayKey = brusselsDayKey(midnight - 12 * 3600 * 1000);
  function openSinceLabel(startedAt: number): string {
    const time = formatBrusselsTime(new Date(startedAt));
    const day = brusselsDayKey(startedAt);
    if (day === todayKey) return time;
    if (day === yesterdayKey) return t("manage.yesterdayAt", { time });
    return `${formatBrusselsShortDate(new Date(startedAt))} ${time}`;
  }

  function noteFor(item: (typeof attentionItems)[number]): string {
    switch (item.reason) {
      case "forgotClockOut": {
        const open = openShifts.find((shift) => shift.employeeId === item.employeeId);
        return t("manage.noteForgotClockOut", {
          when: openSinceLabel(open?.startedAt ?? now),
        });
      }
      case "longBreak":
        return t("manage.noteLongBreak");
      case "notStarted":
        return t("manage.noteNotStarted");
      case "offlineDelayed":
        return t("manage.noteOfflineLate", {
          value: formatDurationMs(offlineLateMs.get(item.employeeId) ?? 0),
        });
      default:
        return t("manage.noteOfflineWeekly", { count: item.count ?? 0 });
    }
  }

  const notesByEmployee = new Map<string, string[]>();
  for (const item of attentionItems) {
    // The pending requests have their own line below the timeline.
    if (item.reason === "pendingQuestions") continue;
    const list = notesByEmployee.get(item.employeeId) ?? [];
    list.push(noteFor(item));
    notesByEmployee.set(item.employeeId, list);
  }

  const people: TeamTimelinePerson[] = rows.map(({ staleOpenSince, ...row }) => {
    const notes = notesByEmployee.get(row.id) ?? [];
    return {
      ...row,
      notes,
      fixHref: notes.length > 0 ? `/manage/medewerker/${row.id}` : null,
      // Without its note, a stale shift's row would say nothing at all.
      status:
        row.status === "" && staleOpenSince !== null && notes.length === 0
          ? t("manage.noteForgotClockOut", { when: openSinceLabel(staleOpenSince) })
          : row.status,
    };
  });
  const attentionCount = people.filter((person) => person.notes.length > 0).length;

  const selectedSite = siteRows.find((site) => site.id === selectedSiteId);
  const siteLabel =
    selectedSite?.name ??
    (siteRows.length > 1 ? t("manage.allSites") : (siteRows[0]?.name ?? null));
  const subtitle = [formatBrusselsLongDay(new Date(now)), siteLabel]
    .filter(Boolean)
    .join(" · ");

  return (
    <ManageShell active="today" wide>
      <AutoRefresh />
      <PageHeader
        title={t("manage.todayHeading")}
        subtitle={subtitle}
        trailing={
          siteRows.length > 1 ? (
            <SiteFilter sites={siteRows} selectedSiteId={selectedSiteId} />
          ) : null
        }
      />
      <NumbersRow
        label={t("manage.numbersLabel")}
        items={[
          { key: "working", label: t("manage.counterWorking"), value: workingCount },
          { key: "break", label: t("manage.counterBreak"), value: onBreakCount },
          {
            key: "notStarted",
            label: t("manage.counterNotStarted"),
            value: notStartedCount,
          },
          {
            key: "attention",
            label: t("manage.counterAttention"),
            value: attentionCount,
            attention: true,
          },
        ]}
      />
      <TeamTimeline
        people={people}
        axis={TIMELINE_AXIS_HOURS.map(
          (hour) =>
            [
              hour,
              positionPct(
                dayWindow.start + (hour - TIMELINE_START_HOUR) * 3600 * 1000,
                dayWindow,
              ),
            ] as const,
        )}
        nowPct={nowPct(now, dayWindow)}
      />
      {pendingCorrectionsCount > 0 ? (
        <GroupedList>
          <ListLinkRow
            href="/manage/vragen"
            title={t("manage.pendingLink", { count: pendingCorrectionsCount })}
          />
        </GroupedList>
      ) : null}
    </ManageShell>
  );
}
