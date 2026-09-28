import {
  brusselsDayKey,
  effectiveEvents,
  type ClockEvent,
  type ClockEventSource,
  type ClockEventType,
} from "@cloxa/domain";
import { t } from "@cloxa/i18n";

import { CorrectionForm } from "@/components/employee/CorrectionForm";
import { addDays, CORRECTION_DAYS, correctionDays } from "@/lib/corrections/days";
import { requireEmployeeArea } from "@/lib/auth/context";
import { nowMs } from "@/lib/clock/now";
import { readChosenSiteId } from "@/lib/clock/site-cookie";
import { createClient } from "@/lib/supabase/server";

import { submitCorrectionAction } from "../actions";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function NewCorrectionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireEmployeeArea();
  const params = await searchParams;
  const now = nowMs();
  // From "Klopt er iets niet?": the day, and the shift, the question is about.
  const datumRaw = first(params.datum);
  const preselected = datumRaw && DATE_PATTERN.test(datumRaw) ? datumRaw : null;
  const dienstRaw = first(params.dienst);
  const parsedDienst = dienstRaw ? Date.parse(dienstRaw) : Number.NaN;
  const shiftStart = Number.isFinite(parsedDienst) ? parsedDienst : null;

  const supabase = await createClient();

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
      : await supabase.from("sites").select("id").in("id", siteIds).eq("active", true);
  if (sitesError) throw new Error(`sites_unavailable:${sitesError.code}`);

  const chosen = sites.length > 1 ? await readChosenSiteId() : null;
  const siteId =
    sites.length === 1
      ? sites[0]!.id
      : (sites.find((site) => site.id === chosen)?.id ?? sites[0]?.id ?? null);

  if (siteId === null) {
    return (
      <div className="flex flex-col gap-4 pt-6 md:pt-0">
        <h1 className="text-title">{t("correctionForm.step1Title")}</h1>
        <p className="text-body text-ink-2">{t("sitePicker.none")}</p>
      </div>
    );
  }

  // The listed days plus a day's buffer on each side, so a shift that started
  // the evening before (an overnight break, say) still derives correctly.
  const oldestDay = [addDays(brusselsDayKey(now), -(CORRECTION_DAYS - 1)), preselected]
    .filter((day): day is string => day !== null)
    .sort()[0]!;
  const dayStart = new Date(`${addDays(oldestDay, -1)}T00:00:00Z`).getTime();
  const dayEnd = now + 24 * 3600 * 1000;

  const { data: eventRows, error: eventsError } = await supabase
    .from("clock_events")
    .select(
      "id, type, occurred_at, employee_id, site_id, source, supersedes_event_id, correction_id, offline",
    )
    .eq("employee_id", context.employeeId)
    .gte("occurred_at", new Date(dayStart).toISOString())
    .lt("occurred_at", new Date(dayEnd).toISOString())
    .order("occurred_at");
  if (eventsError) throw new Error(`clock_events_unavailable:${eventsError.code}`);

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

  const days = correctionDays({
    events: effectiveEvents(events),
    now,
    preselected,
    shiftStart,
  });

  return (
    <div className="flex flex-1 flex-col pt-6 md:pt-0">
      <CorrectionForm
        siteId={siteId}
        days={days}
        preselectedDate={preselected}
        submitAction={submitCorrectionAction}
      />
    </div>
  );
}
