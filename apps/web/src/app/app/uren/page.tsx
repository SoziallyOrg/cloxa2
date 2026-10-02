import { CalendarDays } from "lucide-react";

import { scheduleFor } from "@cloxa/db";
import { brusselsDayKey, deriveShifts, effectiveEvents } from "@cloxa/domain";
import { brusselsLocalToInstant, t } from "@cloxa/i18n";
import { modulesFor } from "@cloxa/modules";

import { formatBarTime } from "@/components/clock/clock-bar";
import { HoursList } from "@/components/employee/HoursList";
import {
  buildHoursWeek,
  parseWeekParam,
  weekRangeLabel,
} from "@/components/employee/hours-week";
import { WeekSwitcher } from "@/components/employee/WeekSwitcher";
import { ScheduleBlocksList } from "@/components/employee/ScheduleBlocksList";
import { SelfExportLink } from "@/components/exports/SelfExportLink";
import { ModuleSection } from "@/components/modules/ModuleSection";
import { EmptyState } from "@/components/ui/EmptyState";
import { List } from "@/components/ui/List";
import { NavBar } from "@/components/ui/NavBar";
import { PageTransition } from "@/components/ui/PageTransition";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { requireEmployeeArea } from "@/lib/auth/context";
import { previewHold } from "@/lib/preview";
import { clockEventFromRow } from "@/lib/modules/events";
import { loadEnabledModules, loadModuleData, loadYearFacts } from "@/lib/modules/load";
import { viewModule } from "@/lib/modules/message";
import { nowMs } from "@/lib/clock/now";
import { addDays } from "@/lib/corrections/days";
import { mondayOfWeek, nextWeekRange, thisWeekRange } from "@/lib/schedule/week-range";
import { createClient } from "@/lib/supabase/server";

type EmployeeArea = Awaited<ReturnType<typeof requireEmployeeArea>>;

/** The employee's module counters and hints, or none when no module applies. */
async function moduleViews(
  context: EmployeeArea,
  supabase: Awaited<ReturnType<typeof createClient>>,
  now: number,
  show: boolean,
) {
  if (!show) return [];
  const [enabled, employee] = await Promise.all([
    loadEnabledModules(supabase, context.membership.organizationId),
    supabase
      .from("employees")
      .select("statute")
      .eq("id", context.employeeId)
      .maybeSingle(),
  ]);
  if (employee.error) throw new Error(`employee_unavailable:${employee.error.code}`);
  const applicable = modulesFor(enabled, employee.data?.statute ?? "other");
  if (applicable.length === 0) return [];
  const [facts, data] = await Promise.all([
    loadYearFacts(supabase, context.employeeId, now),
    loadModuleData(supabase, context.employeeId),
  ]);
  return applicable.map(({ module, config }) =>
    viewModule(module, {
      ...facts,
      config,
      data: data.get(module.id) ?? null,
      audience: "employee",
    }),
  );
}

const DAY_MS = 24 * 3600 * 1000;

export default async function HoursPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireEmployeeArea();
  await previewHold();
  const now = nowMs();
  const params = await searchParams;
  const weekRaw = Array.isArray(params.week) ? params.week[0] : params.week;

  const todayKey = brusselsDayKey(now);
  const currentMonday = mondayOfWeek(todayKey);
  const mondayKey = parseWeekParam(weekRaw, currentMonday);
  const isCurrent = mondayKey === currentMonday;
  const weekStart = brusselsLocalToInstant(mondayKey, "00:00").getTime();
  const weekEnd = brusselsLocalToInstant(addDays(mondayKey, 7), "00:00").getTime();

  const supabase = await createClient();
  // A day's buffer before the week, so a night shift from Sunday still derives right.
  const { data: eventRows, error } = await supabase
    .from("clock_events")
    .select(
      "id, type, occurred_at, employee_id, site_id, source, supersedes_event_id, correction_id, offline, work_location",
    )
    .eq("employee_id", context.employeeId)
    .gte("occurred_at", new Date(weekStart - DAY_MS).toISOString())
    .lt("occurred_at", new Date(weekEnd).toISOString())
    .order("occurred_at");
  if (error) throw new Error(`clock_events_unavailable:${error.code}`);

  const shifts = deriveShifts(effectiveEvents(eventRows.map(clockEventFromRow)));

  // Module counters (ADR 008) that apply to this employee, on the current week only.
  const modules = await moduleViews(context, supabase, now, isCurrent);

  const thisWeek = thisWeekRange(todayKey);
  const nextWeek = nextWeekRange(todayKey);
  const viewedTo = addDays(mondayKey, 6);
  const scheduleRows = await scheduleFor(supabase, {
    employeeId: context.employeeId,
    from: mondayKey < thisWeek.from ? mondayKey : thisWeek.from,
    to: viewedTo > nextWeek.to ? viewedTo : nextWeek.to,
  });
  const thisWeekRows = scheduleRows.filter(
    (row) => row.day >= thisWeek.from && row.day <= thisWeek.to,
  );
  const nextWeekRows = scheduleRows.filter(
    (row) => row.day >= nextWeek.from && row.day <= nextWeek.to,
  );

  const week = buildHoursWeek({
    shifts,
    now,
    mondayKey,
    todayKey,
    planned: scheduleRows,
  });
  const hasHours = week.days.some((day) => day.hasShifts);

  return (
    <PageTransition>
      <PullToRefresh>
        <NavBar title={t("hours.heading")} />
        <List className="pb-10">
          <WeekSwitcher
            label={weekRangeLabel(mondayKey)}
            previousHref={`/app/uren?week=${addDays(mondayKey, -7)}`}
            nextHref={isCurrent ? null : `/app/uren?week=${addDays(mondayKey, 7)}`}
            currentHref={isCurrent ? null : "/app/uren"}
          />

          <section className="flex flex-wrap items-end justify-between gap-4 rounded-card bg-card p-5 shadow-card">
            <div className="flex flex-col gap-1">
              <p className="text-subhead text-ink-2">{t("hours.weekTotalLabel")}</p>
              <p className="text-number">{formatBarTime(week.workedMs)}</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className="rounded-control bg-fill px-3 py-1 text-caption font-bold text-ink-2">
                {t("hours.indicative")}
              </span>
              {week.plannedMs !== null ? (
                <p className="text-subhead text-ink-2">
                  {t("hours.weekPlannedLabel", {
                    value: formatBarTime(week.plannedMs),
                  })}
                </p>
              ) : null}
            </div>
          </section>

          {modules.map((view) => (
            <ModuleSection key={view.id} view={view} />
          ))}

          {hasHours ? (
            <HoursList days={week.days} />
          ) : (
            <div className="rounded-card bg-card shadow-card">
              <EmptyState
                icon={CalendarDays}
                title={t("hours.emptyWeekTitle")}
                body={t("hours.emptyWeekBody")}
              />
            </div>
          )}

          <div className="flex flex-col gap-7 lg:max-w-readable">
            <section className="flex flex-col gap-3">
              <h2 className="px-1 text-title-3">{t("schedule.myScheduleHeading")}</h2>
              <div className="flex flex-col gap-6">
                <ScheduleBlocksList
                  heading={t("schedule.myScheduleThisWeek")}
                  rows={thisWeekRows}
                  testId="schedule-this-week"
                />
                <ScheduleBlocksList
                  heading={t("schedule.myScheduleNextWeek")}
                  rows={nextWeekRows}
                  testId="schedule-next-week"
                />
              </div>
            </section>

            <SelfExportLink heading={t("hours.downloadHeading")} />
          </div>
        </List>
      </PullToRefresh>
    </PageTransition>
  );
}
