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
import {
  brusselsLocalToInstant,
  formatBrusselsLongDay,
  formatBrusselsTime,
  t,
  type CatalogKey,
} from "@cloxa/i18n";

import { DEFAULT_RING_MS, formatBarTime } from "@/components/clock/clock-bar";
import { formatDurationMs } from "@/components/clock/format";
import { brusselsWeekRange, workedMs } from "@/components/clock/week-total";
import { AutoRefresh } from "@/components/manage/AutoRefresh";
import { SiteFilter } from "@/components/manage/SiteFilter";
import { TodayBoard } from "@/components/manage/TodayBoard";
import type { PersonBlock, TodayPerson } from "@/components/manage/today-types";
import { Notice } from "@/components/ui/Notice";
import { NavBar, NavBarButton } from "@/components/ui/NavBar";
import { PageTransition } from "@/components/ui/PageTransition";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { StatBlock } from "@/components/ui/StatBlock";
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
import { GROUP_LABEL_KEY } from "@/lib/manage/labels";
import { decideErrorKey } from "@/lib/manage/errors";
import { loadRequests } from "@/lib/manage/requests";
import { statusGroup, trackTone } from "@/lib/manage/today-board";
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
import { loadTargetRoles, mayCorrect } from "@/lib/manage/correct-access";
import { correctedEmployeeId, correctionHref } from "@/lib/manage/correction-link";
import { previewHold } from "@/lib/preview";
import { createClient } from "@/lib/supabase/server";

import { approveCorrectionAction, rejectCorrectionAction } from "./vragen/actions";

// Wide enough to still catch a shift forgotten open from the previous
// Brussels day, without loading unbounded history.
const EVENTS_LOOKBACK_MS = 3 * 24 * 3600 * 1000;

const PANEL_REQUESTS = 20;

const time = (at: number) => formatBrusselsTime(new Date(at));

const EVENT_LABEL_KEY: Partial<Record<ClockEventType, CatalogKey>> = {
  clock_in: "manageToday.eventClockIn",
  clock_out: "manageToday.eventClockOut",
  break_start: "manageToday.eventBreakStart",
  break_end: "manageToday.eventBreakEnd",
};

const SOURCE_LABEL_KEY = {
  app: "manageToday.sourceApp",
  kiosk: "manageToday.sourceKiosk",
  mobile: "manageToday.sourceMobile",
  correction: "manageToday.sourceCorrection",
} as const;

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

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
  const context = await requireManager();
  await previewHold();
  const supabase = await createClient();
  const now = nowMs();
  const todayKey = brusselsDayKey(now);
  const params = await searchParams;
  const siteRaw = Array.isArray(params.site) ? params.site[0] : params.site;
  const errorRaw = Array.isArray(params.error) ? params.error[0] : params.error;
  const errorKey = decideErrorKey(errorRaw);
  const correctedId = correctedEmployeeId(params.gecorrigeerd);

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
    .select("id, display_name, user_id")
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

  // Who may be offered "Correctie toevoegen" (the database enforces it anyway).
  const targetRoles = await loadTargetRoles(
    supabase,
    context.membership.role,
    context.membership.organizationId,
    visibleEmployees.flatMap((employee) =>
      employee.user_id ? [employee.user_id] : [],
    ),
  );

  const { count: pendingCount, error: pendingError } = await supabase
    .from("correction_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (pendingError)
    throw new Error(`correction_requests_unavailable:${pendingError.code}`);

  const week = brusselsWeekRange(now);
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
          .gte(
            "occurred_at",
            new Date(Math.min(now - EVENTS_LOOKBACK_MS, week.start)).toISOString(),
          )
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
          .gte("server_at", new Date(week.start).toISOString())
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
      // From yesterday on (an overnight block started then) or the start of
      // the week, whichever is earlier, to Sunday: the panel's "gepland".
      scheduleFor(supabase, {
        employeeId: employee.id,
        from: [
          brusselsDayKey(nightLookbackStart(todayKey)),
          brusselsDayKey(week.start),
        ].sort()[0]!,
        to: brusselsDayKey(week.end - 1),
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
  const weekWorkedByEmployee = new Map<string, number>();
  const weekPlannedByEmployee = new Map<string, number>();
  const effectiveByEmployee = new Map<string, readonly ClockEvent[]>();
  const blocksByEmployee = new Map<string, PlannedBlock[]>();
  const boardPeople: BoardPerson[] = [];

  for (const employee of visibleEmployees) {
    const effective = effectiveEvents(eventsByEmployee.get(employee.id) ?? []);
    effectiveByEmployee.set(employee.id, effective);
    const shifts = deriveShifts(effective);
    const scheduled: PlannedBlock[] = (scheduleByEmployee.get(employee.id) ?? []).map(
      (block) => ({ start: Date.parse(block.start_at), end: Date.parse(block.end_at) }),
    );
    // The board only draws the plan up to today; the rest of the week is just a total.
    const blocks = scheduled.filter((block) => brusselsDayKey(block.start) <= todayKey);
    weekWorkedByEmployee.set(
      employee.id,
      sum(
        shifts
          .filter((shift) => shift.start >= week.start && shift.start < week.end)
          .map((shift) => workedMs(shift, now)),
      ),
    );
    weekPlannedByEmployee.set(
      employee.id,
      sum(
        scheduled
          .filter((block) => block.start >= week.start && block.start < week.end)
          .map((block) => block.end - block.start),
      ),
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
  const { working: workingCount, onBreak: onBreakCount } = boardCounts(
    boardPeople,
    now,
  );

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

  const people: TodayPerson[] = visibleEmployees.map((employee) => {
    const todays = boardShiftsByEmployee.get(employee.id) ?? [];
    const blocks = blocksByEmployee.get(employee.id) ?? [];
    const todayBlocks = (scheduleByEmployee.get(employee.id) ?? [])
      .map((block) => ({
        start: Date.parse(block.start_at),
        end: Date.parse(block.end_at),
      }))
      .filter((block) => brusselsDayKey(block.start) === todayKey);
    const todayFirstStart = scheduledStarts.find(
      (entry) => entry.employeeId === employee.id,
    )?.startAt;
    const open = todays.find((shift) => shift.open);
    const lastToday = todays.at(-1);

    let status: string;
    if (open?.openBreak) {
      status = t("manageToday.statusBreakSince", {
        time: time(open.breaks.at(-1)?.start ?? open.start),
      });
    } else if (open) {
      status = t("manage.sinceLabel", {
        time:
          brusselsDayKey(open.start) === todayKey
            ? time(open.start)
            : t("manage.yesterdayAt", { time: time(open.start) }),
      });
    } else if (lastToday?.end) {
      status = t("manageToday.statusStoppedAt", { time: time(lastToday.end) });
    } else if (todayFirstStart !== undefined) {
      status = t("manageToday.statusPlannedFrom", { time: time(todayFirstStart) });
    } else {
      status = t("manageToday.statusFree");
    }

    const net = todays.reduce((total, shift) => total + workedMs(shift, now), 0);
    const personAttention = attentionByPerson.get(employee.id);
    const noteContext: NoteContext = {
      scheduledStart: scheduledStarts.find((entry) => entry.employeeId === employee.id),
      offlineEvents,
      today: todayKey,
      now,
    };
    const canCorrect = mayCorrect(
      { role: context.membership.role, employeeId: context.employeeId },
      {
        employeeId: employee.id,
        userId: employee.user_id,
        role: employee.user_id ? targetRoles.get(employee.user_id) : undefined,
      },
    );
    const personHref = `/manage/medewerker/${employee.id}`;
    const attentionItemsOfPerson = personAttention
      ? personAttention.items.map((item) => ({
          id: item.id,
          label: noteFor(item, noteContext),
          action: actionFor(item),
          fix: item.reason === "forgotClockOut" || item.reason === "notStarted",
          // A forgotten clock-out is fixed right there; the rest only looks.
          href:
            item.reason === "forgotClockOut" && canCorrect && open
              ? correctionHref(employee.id, {
                  date: brusselsDayKey(open.start),
                  forgotClockOut: true,
                  returnTo: "vandaag",
                })
              : personHref,
        }))
      : [];
    const attentionSummary = personAttention
      ? [
          noteFor(personAttention.primary, noteContext),
          personAttention.extra > 0
            ? t("manage.attentionMore", { count: personAttention.extra })
            : null,
        ]
          .filter(Boolean)
          .join(" ")
      : null;

    const group = statusGroup({
      open: open !== undefined,
      onBreak: open?.openBreak ?? false,
      hasAttention: personAttention !== undefined,
    });

    // The ring measures against today's plan, or an 8-hour day without one.
    const plannedToday = sum(todayBlocks.map((block) => block.end - block.start));
    const block: PersonBlock = open
      ? {
          tone: open.openBreak ? "break" : "working",
          title: open.openBreak
            ? status
            : t("manageToday.blockWorkingSince", {
                time:
                  brusselsDayKey(open.start) === todayKey
                    ? time(open.start)
                    : t("manage.yesterdayAt", { time: time(open.start) }),
              }),
          time: formatBarTime(net),
          spoken: formatDurationMs(net),
          progress: Math.min(
            1,
            net / (plannedToday > 0 ? plannedToday : DEFAULT_RING_MS),
          ),
          running: !open.openBreak,
        }
      : {
          tone: "idle",
          title: status,
          time: net > 0 ? formatBarTime(net) : null,
          spoken: net > 0 ? formatDurationMs(net) : null,
          progress: Math.min(
            1,
            net / (plannedToday > 0 ? plannedToday : DEFAULT_RING_MS),
          ),
          running: false,
        };

    // Today's events (and those of a shift still open from earlier), as written.
    const eventsFrom = Math.min(
      brusselsLocalToInstant(todayKey, "00:00").getTime(),
      open?.start ?? Infinity,
    );
    const todaysEvents = (effectiveByEmployee.get(employee.id) ?? []).filter(
      (event) => event.occurredAt >= eventsFrom,
    );
    const events: TodayPerson["events"][number][] = todaysEvents.flatMap((event) => {
      const labelKey = EVENT_LABEL_KEY[event.type];
      return labelKey
        ? [
            {
              time: time(event.occurredAt),
              label: t("manageToday.eventWithSource", {
                label: t(labelKey),
                source: t(SOURCE_LABEL_KEY[event.source]),
              }),
              muted: false,
            },
          ]
        : [];
    });
    if (
      open &&
      !open.openBreak &&
      !todaysEvents.some((e) => e.type === "break_start")
    ) {
      events.push({
        time: t("common.none"),
        label: t("manageToday.noBreakYet"),
        muted: true,
      });
    }
    const plannedEnd = todayBlocks.at(-1)?.end;
    if (plannedEnd !== undefined) {
      events.push({
        time: time(plannedEnd),
        label: t("manageToday.plannedEnd"),
        muted: true,
      });
    }

    const weekWorked = weekWorkedByEmployee.get(employee.id) ?? 0;
    const weekPlanned = weekPlannedByEmployee.get(employee.id) ?? 0;

    return {
      id: employee.id,
      name: employee.display_name,
      group,
      tone: trackTone({
        open: open !== undefined,
        hasAttention: personAttention !== undefined,
      }),
      track: timelineRow({
        shifts: todays,
        planned: blocks,
        now,
        window: day,
      }),
      hours: net > 0 ? formatBarTime(net) : null,
      hoursSpoken: net > 0 ? formatDurationMs(net) : null,
      status,
      statusWord: t(GROUP_LABEL_KEY[group]),
      attentionSummary,
      attentionItems: attentionItemsOfPerson,
      href: personHref,
      correctHref: canCorrect
        ? correctionHref(employee.id, { returnTo: "vandaag" })
        : null,
      block,
      events,
      weekWorked: weekWorked > 0 ? formatBarTime(weekWorked) : null,
      weekPlanned: weekPlanned > 0 ? formatBarTime(weekPlanned) : null,
    };
  });

  // The panel shows the oldest few; Aanvragen has the rest.
  const pendingRequests = await loadRequests(supabase, "pending", {
    limit: PANEL_REQUESTS,
  });

  const correctedName = correctedId
    ? (employeeRows.find((employee) => employee.id === correctedId)?.display_name ??
      null)
    : null;

  const siteName = selectedSiteId
    ? siteRows.find((site) => site.id === selectedSiteId)?.name
    : siteRows.length === 1
      ? siteRows[0]?.name
      : null;
  const subtitle = [formatBrusselsLongDay(new Date(now)), siteName]
    .filter(Boolean)
    .join(" · ");
  const idleCount = Math.max(0, visibleEmployees.length - workingCount - onBreakCount);

  return (
    <PageTransition>
      <AutoRefresh />
      <PullToRefresh>
        <NavBar
          title={t("manageToday.heading")}
          subtitle={subtitle}
          wide
          trailing={
            <>
              {siteRows.length > 1 ? (
                <SiteFilter sites={siteRows} selectedSiteId={selectedSiteId} />
              ) : null}
              <span className="hidden items-center gap-2 md:flex">
                <NavBarButton href="/manage/meer/exports">
                  {t("manageToday.exportAction")}
                </NavBarButton>
                <NavBarButton href="/manage/team" strong>
                  {t("manageTeam.inviteButton")}
                </NavBarButton>
              </span>
            </>
          }
        />
        <div className="@container flex flex-col gap-5 px-gutter pb-10 md:px-gutter-desktop">
          <div
            role="group"
            aria-label={t("manage.numbersLabel")}
            aria-live="polite"
            className="grid grid-cols-2 gap-3 @xl:grid-cols-4"
          >
            <StatBlock
              tone="forest"
              value={workingCount}
              label={t("manageToday.statWorking")}
            />
            <StatBlock
              tone="break"
              value={onBreakCount}
              label={t("manageToday.statBreak")}
            />
            <StatBlock
              tone="idle"
              value={idleCount}
              label={t("manageToday.statIdle")}
            />
            <StatBlock
              tone="danger"
              value={attentionByPerson.size}
              label={t("manageToday.statAttention")}
            />
          </div>
          {errorKey ? <Notice tone="error">{t(errorKey)}</Notice> : null}
          {correctedName ? (
            <Notice tone="success">
              {t("manageCorrection.saved", { name: correctedName })}
            </Notice>
          ) : null}
          <TodayBoard
            people={people}
            nowPct={nowPct(now, day)}
            ticks={windowTicks(day)}
            nowLabel={time(now)}
            windowLabel={`${time(day.start)} – ${time(day.end)}`}
            requests={pendingRequests}
            totalRequests={Math.max(pendingCount ?? 0, pendingRequests.length)}
            approveAction={approveCorrectionAction}
            rejectAction={rejectCorrectionAction}
          />
        </div>
      </PullToRefresh>
    </PageTransition>
  );
}
