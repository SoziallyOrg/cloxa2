import Link from "next/link";
import type { Route } from "next";

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
import { EmptyState } from "@/components/ui/EmptyState";
import { requireEmployeeArea } from "@/lib/auth/context";
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
    <div className="flex flex-col gap-10 pt-6 md:pt-0">
      <h1 className="text-title">{t("hours.heading")}</h1>

      {weekTotal !== null ? (
        <section className="-mt-4 flex flex-col gap-1">
          <p className="text-subhead text-ink-2">{t("hours.weekLabel")}</p>
          <p className="text-number">{formatDurationMs(weekTotal)}</p>
          <p className="text-subhead text-ink-2">{t("hours.indicative")}</p>
        </section>
      ) : null}

      <div className="flex flex-col gap-3">
        {rows.length === 0 ? (
          <EmptyState title={t("shifts.emptyTitle")} body={t("shifts.emptyBody")} />
        ) : (
          <HoursList
            heading={voorRaw ? t("hours.olderHeading") : t("hours.recentHeading")}
            rows={rows}
          />
        )}
        <Link
          href={olderHref as Route}
          className="focus-ring inline-flex min-h-touch-target items-center self-start rounded-control px-4 text-body font-semibold underline-offset-4 hover:underline"
        >
          {t("hours.olderLink")}
        </Link>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-title-2 font-semibold">
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

      <section className="flex flex-col gap-4">
        <h2 className="text-title-2 font-semibold">{t("hours.downloadHeading")}</h2>
        <SelfExportLink />
      </section>
    </div>
  );
}
