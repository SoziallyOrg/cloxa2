import { CalendarDays } from "lucide-react";

import { scheduleFor } from "@cloxa/db";
import {
  brusselsDayKey,
  deriveShifts,
  effectiveEvents,
  type ClockEvent,
  type ClockEventSource,
  type ClockEventType,
} from "@cloxa/domain";
import { formatBrusselsDate, t } from "@cloxa/i18n";

import { formatDurationMs } from "@/components/clock/format";
import { formatShiftRow } from "@/components/clock/shift-row";
import { weekTotalMs, workedMs } from "@/components/clock/week-total";
import { HoursList, type HoursRow } from "@/components/employee/HoursList";
import { ScheduleBlocksList } from "@/components/employee/ScheduleBlocksList";
import { SelfExportLink } from "@/components/exports/SelfExportLink";
import { AccountButton } from "@/components/employee/Account";
import { EmptyState } from "@/components/ui/EmptyState";
import { List, Row, Section } from "@/components/ui/List";
import { NavBar } from "@/components/ui/NavBar";
import { PageTransition } from "@/components/ui/PageTransition";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { requireEmployeeArea } from "@/lib/auth/context";
import { previewHold } from "@/lib/preview";
import { nowMs } from "@/lib/clock/now";
import { nextWeekRange, thisWeekRange } from "@/lib/schedule/week-range";
import { createClient } from "@/lib/supabase/server";

const WINDOW_DAYS = 14;
const WINDOW_MS = WINDOW_DAYS * 24 * 3600 * 1000;
// Extra lookback so a shift that started just before the window still shows fully.
const FETCH_BUFFER_MS = 24 * 3600 * 1000;

export default async function HoursPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireEmployeeArea();
  await previewHold();
  const now = nowMs();
  const params = await searchParams;
  const voorRaw = Array.isArray(params.voor) ? params.voor[0] : params.voor;
  const parsedVoor = voorRaw ? Date.parse(voorRaw) : Number.NaN;
  const windowEnd = Number.isFinite(parsedVoor) ? parsedVoor : now;
  const windowStart = windowEnd - WINDOW_MS;

  const supabase = await createClient();
  const { data: eventRows, error } = await supabase
    .from("clock_events")
    .select(
      "id, type, occurred_at, employee_id, site_id, source, supersedes_event_id, correction_id, offline",
    )
    .eq("employee_id", context.employeeId)
    .gte("occurred_at", new Date(windowStart - FETCH_BUFFER_MS).toISOString())
    .lt("occurred_at", new Date(windowEnd).toISOString())
    .order("occurred_at");
  if (error) throw new Error(`clock_events_unavailable:${error.code}`);

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
  const shifts = deriveShifts(effectiveEvents(events))
    .filter((shift) => shift.start >= windowStart)
    .sort((a, b) => b.start - a.start);

  // The week total only makes sense for the current window, not an older page.
  const showWeekTotal = !voorRaw;
  const weekTotal = showWeekTotal ? weekTotalMs(shifts, now) : null;

  const olderHref = `/app/uren?voor=${encodeURIComponent(new Date(windowStart).toISOString())}`;

  const todayKey = brusselsDayKey(now);
  const thisWeek = thisWeekRange(todayKey);
  const nextWeek = nextWeekRange(todayKey);
  const scheduleRows = await scheduleFor(supabase, {
    employeeId: context.employeeId,
    from: thisWeek.from,
    to: nextWeek.to,
  });
  const thisWeekRows = scheduleRows.filter((row) => row.day <= thisWeek.to);
  const nextWeekRows = scheduleRows.filter((row) => row.day >= nextWeek.from);

  const rows: HoursRow[] = shifts.map((shift, index) => {
    const row = formatShiftRow(shift);
    return {
      key: `${shift.start}-${index}`,
      date: row.date,
      longDate: formatBrusselsDate(new Date(shift.start)),
      range: row.range,
      pause: row.pause,
      // An open shift counts up to now, like the week total.
      net: shift.open ? formatDurationMs(workedMs(shift, now)) : row.net,
      edited: row.edited,
      offline: row.offline,
      offlineSkew: row.offlineSkew,
      correctionHref: `/app/vragen/nieuw?datum=${brusselsDayKey(shift.start)}&dienst=${encodeURIComponent(new Date(shift.start).toISOString())}`,
    };
  });

  return (
    <PageTransition>
      <PullToRefresh>
        <NavBar
          title={t("hours.heading")}
          trailing={<AccountButton placement="bar" />}
        />
        <List className="pb-10">
          {weekTotal !== null ? (
            <section className="flex flex-col gap-0.5 rounded-list bg-surface px-4 py-3.5">
              <p className="text-subhead text-ink-2">{t("hours.weekLabel")}</p>
              <p className="text-number">{formatDurationMs(weekTotal)}</p>
              <p className="text-subhead text-ink-2">{t("hours.indicative")}</p>
            </section>
          ) : null}

          {rows.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title={t("shifts.emptyTitle")}
              body={t("shifts.emptyBody")}
            />
          ) : (
            <HoursList
              heading={voorRaw ? t("hours.olderHeading") : t("hours.recentHeading")}
              rows={rows}
            />
          )}

          <Section>
            <Row href={olderHref} title={t("hours.olderLink")} />
          </Section>

          <section className="flex flex-col gap-3">
            <h2 className="px-4 text-title-3 font-semibold">
              {t("schedule.myScheduleHeading")}
            </h2>
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
          </section>

          <SelfExportLink heading={t("hours.downloadHeading")} />
        </List>
      </PullToRefresh>
    </PageTransition>
  );
}
