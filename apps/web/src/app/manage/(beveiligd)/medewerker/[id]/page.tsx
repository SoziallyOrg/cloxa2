import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";

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
  formatBrusselsDate,
  formatBrusselsTime,
  t,
  type CatalogKey,
} from "@cloxa/i18n";

import { ManageShell } from "@/components/manage/ManageShell";
import { ShiftList } from "@/components/clock/ShiftList";
import { PinForm } from "@/components/kiosk/PinForm";
import { buttonClassName } from "@/components/ui/Button";
import { Heading } from "@/components/ui/Heading";
import { requireManager } from "@/lib/auth/context";
import { nowMs } from "@/lib/clock/now";
import { formatWeeklyHours } from "@/lib/schedule/hours";
import { createClient } from "@/lib/supabase/server";

import { setEmployeePinAction } from "./actions";

const WINDOW_DAYS = 14;
const WINDOW_MS = WINDOW_DAYS * 24 * 3600 * 1000;
const FETCH_BUFFER_MS = 24 * 3600 * 1000;
const SCHEDULE_DAYS_AHEAD = 6;

const STATUS_LABEL_KEY: Record<string, CatalogKey> = {
  pending: "questions.statusPending",
  approved: "questions.statusApproved",
  rejected: "questions.statusRejected",
  withdrawn: "questions.statusWithdrawn",
};

export default async function ManageEmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await requireManager();
  const { id } = await params;
  const supabase = await createClient();

  const { data: employee, error: employeeError } = await supabase
    .from("employees")
    .select("id, display_name, employee_code, statute")
    .eq("id", id)
    .maybeSingle();
  if (employeeError) throw new Error(`employee_unavailable:${employeeError.code}`);
  if (!employee) notFound();

  const { count: pendingCount } = await supabase
    .from("correction_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  const now = nowMs();
  const windowStart = now - WINDOW_MS;

  const { data: eventRows, error: eventsError } = await supabase
    .from("clock_events")
    .select(
      "id, type, occurred_at, employee_id, site_id, source, supersedes_event_id, correction_id, offline, server_at",
    )
    .eq("employee_id", employee.id)
    .gte("occurred_at", new Date(windowStart - FETCH_BUFFER_MS).toISOString())
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
    ...(row.offline ? { offline: true, serverAt: Date.parse(row.server_at) } : {}),
  }));
  const shifts = deriveShifts(effectiveEvents(events))
    .filter((shift) => shift.start >= windowStart)
    .sort((a, b) => b.start - a.start);

  const { data: correctionRows, error: correctionsError } = await supabase
    .from("correction_requests")
    .select("id, kind, status, reason, decision_note, created_at")
    .eq("employee_id", employee.id)
    .order("created_at", { ascending: false })
    .limit(30);
  if (correctionsError) {
    throw new Error(`correction_requests_unavailable:${correctionsError.code}`);
  }

  const { data: pinRow, error: pinError } = await supabase
    .from("employee_pins")
    .select("set_at")
    .eq("employee_id", employee.id)
    .maybeSingle();
  if (pinError) throw new Error(`employee_pins_unavailable:${pinError.code}`);

  const todayKey = brusselsDayKey(now);
  const toKey = brusselsDayKey(now + SCHEDULE_DAYS_AHEAD * 24 * 3600 * 1000);
  const scheduleRows = await scheduleFor(supabase, {
    employeeId: employee.id,
    from: todayKey,
    to: toKey,
  });

  return (
    <ManageShell
      active="team"
      pendingQuestionsCount={pendingCount ?? 0}
      showSwitchToEmployee={context.employeeId !== null}
    >
      <div className="flex flex-col gap-8">
        <Link
          href={"/manage/team" as Route}
          className="focus-ring self-start font-semibold text-primary underline"
        >
          {t("manageEmployee.backLink")}
        </Link>
        <Heading level={1}>{employee.display_name}</Heading>

        <section className="flex flex-col gap-3">
          <Heading level={2}>{t("manageEmployee.shiftsHeading")}</Heading>
          <ShiftList shifts={shifts} showOfflineSkew />
        </section>

        <section className="flex flex-col gap-3">
          <Heading level={2}>{t("manageEmployee.correctionsHeading")}</Heading>
          {correctionRows.length === 0 ? (
            <p className="text-ink/70">{t("manageEmployee.noCorrections")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {correctionRows.map((row) => (
                <li key={row.id} className="rounded-lg border border-border p-4">
                  <p className="font-semibold">
                    {formatBrusselsDate(new Date(row.created_at))} ·{" "}
                    {t(STATUS_LABEL_KEY[row.status] ?? "questions.statusPending")}
                  </p>
                  <p className="text-ink/70">{row.reason}</p>
                  {row.decision_note ? (
                    <p className="text-ink/70">
                      {t("questions.managerNote", { note: row.decision_note })}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <Heading level={2}>{t("manageEmployee.scheduleHeading")}</Heading>
          {scheduleRows.length > 0 ? (
            <p className="font-semibold">
              {t("manageEmployee.scheduleSummaryHours", {
                hours: formatWeeklyHours(
                  scheduleRows.reduce(
                    (total, row) =>
                      total +
                      (Date.parse(row.end_at) - Date.parse(row.start_at)) / 60_000,
                    0,
                  ),
                ),
              })}
            </p>
          ) : null}
          <Link
            href={`/manage/medewerker/${employee.id}/rooster` as Route}
            className={buttonClassName("secondary", "md")}
          >
            {t("manageEmployee.scheduleEditLink")}
          </Link>
          {scheduleRows.length === 0 ? (
            <p className="text-ink/70">{t("manageEmployee.noSchedule")}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {scheduleRows.map((row, index) => {
                const range = `${formatBrusselsTime(new Date(row.start_at))}–${formatBrusselsTime(new Date(row.end_at))}`;
                return (
                  <li key={index} className="text-ink/70">
                    {t("manageEmployee.scheduleRow", {
                      date: formatBrusselsDate(new Date(row.start_at)),
                      range,
                    })}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <Heading level={2}>{t("kiosk.pinSettingsHeading")}</Heading>
          <p className="text-ink/70">
            {pinRow
              ? t("kiosk.managerPinSetAt", {
                  date: formatBrusselsDate(new Date(pinRow.set_at)),
                })
              : t("kiosk.managerPinNone")}
          </p>
          <div className="max-w-md">
            <PinForm
              id="employee-pin"
              submitLabel={t("kiosk.managerPinSubmit")}
              savedMessage={t("kiosk.managerPinSaved")}
              action={setEmployeePinAction.bind(null, employee.id)}
            />
          </div>
        </section>
      </div>
    </ManageShell>
  );
}
