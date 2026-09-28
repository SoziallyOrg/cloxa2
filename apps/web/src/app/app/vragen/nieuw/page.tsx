import {
  brusselsDayKey,
  effectiveEvents,
  type ClockEvent,
  type ClockEventSource,
  type ClockEventType,
} from "@cloxa/domain";
import { t } from "@cloxa/i18n";

import { AppShell } from "@/components/employee/AppShell";
import { CorrectionForm } from "@/components/employee/CorrectionForm";
import { Heading } from "@/components/ui/Heading";
import type { CorrectionTargetOption } from "@/lib/corrections/form";
import { requireEmployeeArea } from "@/lib/auth/context";
import { nowMs } from "@/lib/clock/now";
import { readChosenSiteId } from "@/lib/clock/site-cookie";
import { createClient } from "@/lib/supabase/server";

import { submitCorrectionAction } from "../actions";

const DAY_MS = 24 * 3600 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export default async function NewCorrectionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireEmployeeArea();
  const params = await searchParams;
  const datumRaw = Array.isArray(params.datum) ? params.datum[0] : params.datum;
  const defaultDate =
    datumRaw && DATE_PATTERN.test(datumRaw) ? datumRaw : brusselsDayKey(nowMs());

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
      <AppShell active="questions">
        <Heading level={1}>{t("correctionForm.step1Title")}</Heading>
        <p>{t("sitePicker.none")}</p>
      </AppShell>
    );
  }

  // A day's window plus a buffer, so a shift that started the evening before
  // (an overnight break, say) still offers its events as targets.
  const dayStart = new Date(`${defaultDate}T00:00:00Z`).getTime() - DAY_MS;
  const dayEnd = new Date(`${defaultDate}T00:00:00Z`).getTime() + 2 * DAY_MS;

  const { data: eventRows, error: eventsError } = await supabase
    .from("clock_events")
    .select(
      "id, type, occurred_at, employee_id, site_id, source, supersedes_event_id, correction_id",
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
  }));

  const targets: CorrectionTargetOption[] = effectiveEvents(events)
    .filter((event) => brusselsDayKey(event.occurredAt) === defaultDate)
    .map((event) => ({
      id: event.id,
      type: event.type as CorrectionTargetOption["type"],
      occurredAtIso: new Date(event.occurredAt).toISOString(),
    }));

  return (
    <AppShell active="questions">
      <Heading level={1}>{t("correctionForm.step1Title")}</Heading>
      <CorrectionForm
        siteId={siteId}
        targets={targets}
        defaultDate={defaultDate}
        submitAction={submitCorrectionAction}
      />
    </AppShell>
  );
}
