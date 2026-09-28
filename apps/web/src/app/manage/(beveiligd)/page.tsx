import { scheduleFor } from "@cloxa/db";
import {
  brusselsDayKey,
  deriveShifts,
  effectiveEvents,
  type ClockEvent,
  type ClockEventSource,
  type ClockEventType,
  type Shift,
} from "@cloxa/domain";
import { formatBrusselsLongDay, formatBrusselsTime, t } from "@cloxa/i18n";

import { formatDurationMs } from "@/components/clock/format";
import { brusselsWeekRange, workedMs } from "@/components/clock/week-total";
import { AutoRefresh } from "@/components/manage/AutoRefresh";
import { SiteFilter } from "@/components/manage/SiteFilter";
import {
  TeamTimeline,
  type TeamTimelinePerson,
} from "@/components/manage/TeamTimeline";
import { NavBar } from "@/components/ui/NavBar";
import { NumbersRow } from "@/components/ui/NumbersRow";
import { PageTransition } from "@/components/ui/PageTransition";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { requireManager } from "@/lib/auth/context";
import { nowMs } from "@/lib/clock/now";
import {
  attentionByEmployee,
  buildAttention,
  type AttentionItem,
  type OfflineEvent,
  type OpenShiftStatus,
  type ScheduledStart,
} from "@/lib/manage/attention";
import { boardCounts, type BoardPerson } from "@/lib/manage/board-counts";
import {
  boardWindow,
  nightLookbackStart,
  nowPct,
  timelineRow,
  timelineWindow,
  windowTicks,
  type PlannedBlock,
} from "@/lib/manage/timeline";
import { blocksForOpenShift, plannedEndForOpenShift } from "@/lib/schedule/open-shift";
import { previewHold } from "@/lib/preview";
import { createClient } from "@/lib/supabase/server";

// Wide enough to still catch a shift forgotten open from the previous
// Brussels day, without loading unbounded history.
const EVENTS_LOOKBACK_MS = 3 * 24 * 3600 * 1000;

const time = (at: number) => formatBrusselsTime(new Date(at));

interface NoteContext {
  scheduledStart: ScheduledStart | undefined;
  offlineEvents: readonly OfflineEvent[];
  today: string;
  now: number;
}

/** One short line for one "aandacht nodig" item, in plain words. */
function noteFor(item: AttentionItem, context: NoteContext): string {
  switch (item.reason) {
    case "forgotClockOut":
      return item.plannedEnd !== undefined
        ? t("manage.noteForgotPlanned", { time: time(item.plannedEnd) })
        : t("manage.noteForgotLong", { value: formatDurationMs(item.durationMs ?? 0) });
    case "longBreak":
      return t("manage.noteLongBreak");
    case "notStarted":
      return t("manage.noteNotStarted", {
        time: time(context.scheduledStart?.startAt ?? context.now),
      });
    case "offlineDelayed": {
      const delay = context.offlineEvents
        .filter(
          (event) =>
            event.employeeId === item.employeeId &&
            brusselsDayKey(event.serverAt) === context.today,
        )
        .reduce(
          (longest, event) => Math.max(longest, event.serverAt - event.occurredAt),
          0,
        );
      return t("manage.noteOfflineLate", { delay: formatDurationMs(delay) });
    }
    case "offlineWeekly":
      return t("manage.noteOfflineWeekly", { count: item.count ?? 0 });
    default:
      return "";
  }
}

/** Looking is enough for patterns; a forgotten or missing clock-in needs a fix. */
function actionFor(item: AttentionItem): string {
  return item.reason === "forgotClockOut" || item.reason === "notStarted"
    ? t("manage.fix")
    : t("manage.viewAction");
}

export default async function ManagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Layouts don't re-run on client navigation, so every page checks too.
  await requireManager();
  await previewHold();
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
      // From yesterday on: an overnight block (21:30–06:00) started then.
      scheduleFor(supabase, {
        employeeId: employee.id,
        from: brusselsDayKey(nightLookbackStart(todayKey)),
        to: todayKey,
      }),
    ),
  );
  const scheduleByEmployee = new Map(
    visibleEmployees.map((employee, index) => [employee.id, scheduleResults[index]!]),
  );

  const baseWindow = timelineWindow(todayKey);
  // The board is the current state plus today's plan: whatever is open now,
  // and anything worked since the night lookback (18:00 yesterday) when it is
  // still night. Never just "started on today's calendar date".
  const boardSince =
    now < baseWindow.start ? nightLookbackStart(todayKey) : baseWindow.start;
  const openShifts: OpenShiftStatus[] = [];
  const scheduledStarts: ScheduledStart[] = [];
  const clockedInEmployeeIds = new Set<string>();
  const boardShiftsByEmployee = new Map<string, Shift[]>();
  const blocksByEmployee = new Map<string, PlannedBlock[]>();
  const boardPeople: BoardPerson[] = [];

  for (const employee of visibleEmployees) {
    const shifts = deriveShifts(
      effectiveEvents(eventsByEmployee.get(employee.id) ?? []),
    );
    const blocks: PlannedBlock[] = (scheduleByEmployee.get(employee.id) ?? []).map(
      (block) => ({ start: Date.parse(block.start_at), end: Date.parse(block.end_at) }),
    );
    const todayBlocks = blocks.filter(
      (block) => brusselsDayKey(block.start) === todayKey,
    );
    const boardShifts = shifts.filter(
      (shift) =>
        brusselsDayKey(shift.start) === todayKey || (shift.end ?? now) > boardSince,
    );
    boardShiftsByEmployee.set(employee.id, boardShifts);

    const last = shifts.at(-1) ?? null;
    const open = last && last.open ? last : null;
    // Planned blocks to draw: the ones around the open shift, else what is
    // still ahead or running today (an overnight block from yesterday too).
    blocksByEmployee.set(
      employee.id,
      open
        ? blocksForOpenShift(open.start, blocks)
        : blocks.filter((block) => block.end > boardSince),
    );

    const clockedToday = shifts.some(
      (shift) => brusselsDayKey(shift.start) === todayKey,
    );
    // Someone on last night's shift is working, not "not started".
    if (clockedToday || open) clockedInEmployeeIds.add(employee.id);

    const firstBlock = todayBlocks[0];
    if (firstBlock) {
      scheduledStarts.push({
        employeeId: employee.id,
        employeeName: employee.display_name,
        startAt: firstBlock.start,
      });
    }
    boardPeople.push({
      open: open ? { onBreak: open.openBreak } : null,
      clockedToday,
      firstStartToday: firstBlock?.start ?? null,
    });

    if (open) {
      openShifts.push({
        employeeId: employee.id,
        employeeName: employee.display_name,
        startedAt: open.start,
        openBreakStartedAt: open.openBreak ? (open.breaks.at(-1)?.start ?? null) : null,
        plannedEnd: plannedEndForOpenShift(open.start, blocks),
      });
    }
  }
  const {
    working: workingCount,
    onBreak: onBreakCount,
    notStarted: notStartedCount,
  } = boardCounts(boardPeople, now);

  const day = boardWindow({
    dayKey: todayKey,
    now,
    shiftStarts: [...boardShiftsByEmployee.values()].flatMap((list) =>
      list.map((shift) => shift.start),
    ),
    planned: [...blocksByEmployee.values()].flat(),
  });

  const attentionItems = buildAttention({
    openShifts,
    scheduledStarts,
    clockedInEmployeeIds,
    offlineEvents,
    pendingCorrectionsCount: pendingCount ?? 0,
    now,
  });
  // Pending requests have their own count on Aanvragen; here only people.
  const attentionByPerson = attentionByEmployee(attentionItems);

  const people: TeamTimelinePerson[] = visibleEmployees.map((employee) => {
    const todays = boardShiftsByEmployee.get(employee.id) ?? [];
    const blocks = blocksByEmployee.get(employee.id) ?? [];
    const todayFirstStart = scheduledStarts.find(
      (entry) => entry.employeeId === employee.id,
    )?.startAt;
    const open = todays.find((shift) => shift.open);
    const lastToday = todays.at(-1);

    let status: string;
    let statusWord: string | null = null;
    if (open?.openBreak) {
      status = t("manage.statusBreakSince", {
        time: time(open.breaks.at(-1)?.start ?? open.start),
      });
    } else if (open) {
      statusWord = t("manage.statusWorkingLabel");
      status = t("manage.sinceLabel", {
        time:
          brusselsDayKey(open.start) === todayKey
            ? time(open.start)
            : t("manage.yesterdayAt", { time: time(open.start) }),
      });
    } else if (lastToday?.end) {
      status = t("manage.statusStoppedAt", { time: time(lastToday.end) });
    } else if (todayFirstStart !== undefined) {
      status = t("manage.statusStartAt", { time: time(todayFirstStart) });
    } else {
      status = t("manage.statusFree");
    }

    const net = todays.reduce((total, shift) => total + workedMs(shift, now), 0);
    const personAttention = attentionByPerson.get(employee.id);
    const attention: TeamTimelinePerson["attention"] = personAttention
      ? (() => {
          const context: NoteContext = {
            scheduledStart: scheduledStarts.find(
              (entry) => entry.employeeId === employee.id,
            ),
            offlineEvents,
            today: todayKey,
            now,
          };
          return {
            summary: noteFor(personAttention.primary, context),
            extra: personAttention.extra,
            href: `/manage/medewerker/${employee.id}`,
            items: personAttention.items.map((item) => ({
              id: item.id,
              label: noteFor(item, context),
              action: actionFor(item),
            })),
          };
        })()
      : null;

    return {
      id: employee.id,
      name: employee.display_name,
      status,
      statusWord,
      attention,
      net: net > 0 ? formatDurationMs(net) : null,
      track: timelineRow({
        shifts: todays,
        planned: blocks,
        now,
        window: day,
      }),
    };
  });

  const siteName = selectedSiteId
    ? siteRows.find((site) => site.id === selectedSiteId)?.name
    : siteRows.length === 1
      ? siteRows[0]?.name
      : null;
  const subtitle = [formatBrusselsLongDay(new Date(now)), siteName]
    .filter(Boolean)
    .join(" · ");

  return (
    <PageTransition>
      <AutoRefresh />
      <PullToRefresh>
        <NavBar
          title={t("manage.todayHeading")}
          subtitle={subtitle}
          wide
          trailing={
            siteRows.length > 1 ? (
              <SiteFilter sites={siteRows} selectedSiteId={selectedSiteId} />
            ) : null
          }
        />
        <div className="flex flex-col gap-8 px-gutter pb-10">
          <NumbersRow
            label={t("manage.numbersLabel")}
            items={[
              {
                key: "working",
                label: t("manage.counterWorking"),
                value: workingCount,
              },
              { key: "break", label: t("manage.counterBreak"), value: onBreakCount },
              {
                key: "notStarted",
                label: t("manage.counterNotStarted"),
                value: notStartedCount,
              },
              {
                key: "attention",
                label: t("manage.counterAttention"),
                value: attentionByPerson.size,
                attention: true,
              },
            ]}
          />
          <TeamTimeline
            people={people}
            nowPct={nowPct(now, day)}
            ticks={windowTicks(day)}
          />
        </div>
      </PullToRefresh>
    </PageTransition>
  );
}
