import { notFound } from "next/navigation";
import { MapPin, ShieldAlert } from "lucide-react";
import { z } from "zod";

import { scheduleFor } from "@cloxa/db";
import { brusselsDayKey, deriveShifts, effectiveEvents } from "@cloxa/domain";
import { formatBrusselsTime, t } from "@cloxa/i18n";

import { CorrectionForm } from "@/components/employee/CorrectionForm";
import { EmptyState } from "@/components/ui/EmptyState";
import { NavBar } from "@/components/ui/NavBar";
import { PageTransition } from "@/components/ui/PageTransition";
import { requireManager } from "@/lib/auth/context";
import { nowMs } from "@/lib/clock/now";
import { addDays, CORRECTION_DAYS, correctionDays } from "@/lib/corrections/days";
import type { CorrectionFormState } from "@/lib/corrections/form";
import { loadTargetRoles, mayCorrect } from "@/lib/manage/correct-access";
import { defaultSiteId, parseCorrectionPrefill } from "@/lib/manage/correction-link";
import { CLOCK_EVENT_COLUMNS, clockEventFromRow } from "@/lib/modules/events";
import { previewHold } from "@/lib/preview";
import { plannedEndForOpenShift } from "@/lib/schedule/open-shift";
import { createClient } from "@/lib/supabase/server";

import { managerCorrectAction } from "../actions";

const DAY_MS = 24 * 3600 * 1000;
const PREFILL_DAYS = 60;

/** A manager corrects an employee's hours: the 3-step wizard, reason required. */
export default async function ManagerCorrectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireManager();
  await previewHold();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const now = nowMs();
  const today = brusselsDayKey(now);
  // A link can only point at the recent past (the database refuses older anyway).
  const prefill = parseCorrectionPrefill(await searchParams, {
    earliest: addDays(today, -PREFILL_DAYS),
    latest: today,
  });
  const supabase = await createClient();

  const { data: employee, error: employeeError } = await supabase
    .from("employees")
    .select("id, display_name, user_id, left_at, anonymised_at")
    .eq("id", id)
    .maybeSingle();
  if (employeeError) throw new Error(`employee_unavailable:${employeeError.code}`);
  if (!employee) notFound();

  const back =
    prefill.returnTo === "vandaag"
      ? { href: "/manage", label: t("manageToday.heading") }
      : { href: `/manage/medewerker/${employee.id}`, label: employee.display_name };
  const title = t("manageCorrection.title", { name: employee.display_name });

  const inactive = employee.left_at !== null || employee.anonymised_at !== null;
  const roles = await loadTargetRoles(
    supabase,
    context.membership.role,
    context.membership.organizationId,
    employee.user_id ? [employee.user_id] : [],
  );
  const allowed = mayCorrect(
    { role: context.membership.role, employeeId: context.employeeId },
    {
      employeeId: employee.id,
      userId: employee.user_id,
      role: employee.user_id ? roles.get(employee.user_id) : undefined,
      inactive,
    },
  );
  if (!allowed) {
    return (
      <PageTransition>
        <NavBar title={title} back={back} />
        <EmptyState
          icon={ShieldAlert}
          title={t("manageCorrection.notAllowedTitle")}
          body={
            inactive
              ? t("manageCorrection.inactiveBody")
              : t("manageCorrection.notAllowedBody")
          }
        />
      </PageTransition>
    );
  }

  const { data: assignments, error: assignmentsError } = await supabase
    .from("site_assignments")
    .select("site_id")
    .eq("employee_id", employee.id);
  if (assignmentsError) {
    throw new Error(`site_assignments_unavailable:${assignmentsError.code}`);
  }
  const siteIds = assignments.map((row) => row.site_id);
  const { data: siteRows, error: sitesError } =
    siteIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("sites")
          .select("id, name")
          .in("id", siteIds)
          .eq("active", true)
          .order("name");
  if (sitesError) throw new Error(`sites_unavailable:${sitesError.code}`);
  if (siteRows.length === 0) {
    return (
      <PageTransition>
        <NavBar title={title} back={back} />
        <EmptyState
          icon={MapPin}
          title={t("manageCorrection.noSitesTitle")}
          body={t("manageCorrection.noSitesBody")}
        />
      </PageTransition>
    );
  }

  // Registrations from a day before the oldest listed day (so a shift that
  // started the evening before still derives) up to now. The employee's rows
  // are readable through the manager's RLS scope.
  const oldestDay = [addDays(brusselsDayKey(now), -(CORRECTION_DAYS - 1)), prefill.date]
    .filter((day): day is string => day !== null)
    .sort()[0]!;
  const { data: eventRows, error: eventsError } = await supabase
    .from("clock_events")
    .select(CLOCK_EVENT_COLUMNS)
    .eq("employee_id", employee.id)
    .gte("occurred_at", new Date(`${addDays(oldestDay, -1)}T00:00:00Z`).toISOString())
    .lt("occurred_at", new Date(now + DAY_MS).toISOString())
    .order("occurred_at");
  if (eventsError) throw new Error(`clock_events_unavailable:${eventsError.code}`);
  const effective = effectiveEvents(eventRows.map(clockEventFromRow));

  // A forgotten clock-out: start at the time, with the planned end proposed
  // when the schedule has one (and it is not in the future).
  let date = prefill.date;
  let initial: Partial<CorrectionFormState> = {};
  if (prefill.forgotClockOut && date !== null) {
    let time = "";
    const open =
      deriveShifts(effective).find(
        (shift) => shift.open && brusselsDayKey(shift.start) === date,
      ) ?? null;
    if (open) {
      const blocks = (
        await scheduleFor(supabase, {
          employeeId: employee.id,
          from: addDays(date, -1),
          to: addDays(date, 1),
        })
      ).map((row) => ({
        start: Date.parse(row.start_at),
        end: Date.parse(row.end_at),
      }));
      const plannedEnd = plannedEndForOpenShift(open.start, blocks);
      if (plannedEnd !== null && plannedEnd <= now) {
        date = brusselsDayKey(plannedEnd);
        time = formatBrusselsTime(new Date(plannedEnd));
      }
    }
    initial = { step: 2, kind: "add", eventType: "clock_out", date, time };
  }

  const days = correctionDays({ events: effective, now, preselected: date });
  const siteId = defaultSiteId(effective, siteRows, brusselsDayKey, prefill.date);

  return (
    <CorrectionForm
      siteId={siteId ?? siteRows[0]!.id}
      manager={{ employeeName: employee.display_name, sites: siteRows }}
      initial={initial}
      days={days}
      preselectedDate={date}
      back={back}
      submitAction={managerCorrectAction.bind(null, employee.id, prefill.returnTo)}
    />
  );
}
