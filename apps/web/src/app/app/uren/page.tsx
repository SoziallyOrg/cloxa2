import Link from "next/link";
import type { Route } from "next";

import {
  brusselsDayKey,
  deriveShifts,
  effectiveEvents,
  type ClockEvent,
  type ClockEventSource,
  type ClockEventType,
} from "@cloxa/domain";
import { t } from "@cloxa/i18n";

import { AppShell } from "@/components/employee/AppShell";
import { formatDurationMs } from "@/components/clock/format";
import { ShiftList } from "@/components/clock/ShiftList";
import { weekTotalMs } from "@/components/clock/week-total";
import { Heading } from "@/components/ui/Heading";
import { requireEmployeeArea } from "@/lib/auth/context";
import { nowMs } from "@/lib/clock/now";
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
      "id, type, occurred_at, employee_id, site_id, source, supersedes_event_id, correction_id",
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
  }));
  const shifts = deriveShifts(effectiveEvents(events))
    .filter((shift) => shift.start >= windowStart)
    .sort((a, b) => b.start - a.start);

  // The week total only makes sense for the current window, not an older page.
  const showWeekTotal = !voorRaw;
  const weekTotal = showWeekTotal ? weekTotalMs(shifts, now) : null;

  const olderHref = `/app/uren?voor=${encodeURIComponent(new Date(windowStart).toISOString())}`;

  return (
    <AppShell active="hours">
      <Heading level={1}>{t("hours.heading")}</Heading>
      {weekTotal !== null ? (
        <p className="text-lg font-semibold">
          {t("hours.weekTotal", { value: formatDurationMs(weekTotal) })}
        </p>
      ) : null}
      <ShiftList
        shifts={shifts}
        correctionHref={(shift) =>
          `/app/vragen/nieuw?datum=${brusselsDayKey(shift.start)}`
        }
      />
      <p>
        <Link
          href={olderHref as Route}
          className="focus-ring font-semibold text-primary underline"
        >
          {t("hours.olderLink")}
        </Link>
      </p>
    </AppShell>
  );
}
