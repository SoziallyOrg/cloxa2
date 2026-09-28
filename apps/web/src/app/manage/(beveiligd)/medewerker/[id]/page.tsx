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
  formatBrusselsShortDate,
  formatBrusselsTime,
  t,
  type CatalogKey,
} from "@cloxa/i18n";

import { ShiftList } from "@/components/clock/ShiftList";
import {
  OffboardRow,
  ReinstateRow,
  SignOutEverywhereRow,
} from "@/components/manage/EmploymentActions";
import { ManageShell } from "@/components/manage/ManageShell";
import { PinRow } from "@/components/manage/PinRow";
import { BackLink } from "@/components/ui/BackLink";
import { GroupedList, ListLinkRow, ListRow } from "@/components/ui/GroupedList";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusLine } from "@/components/ui/StatusLine";
import { requireManager } from "@/lib/auth/context";
import { nowMs } from "@/lib/clock/now";
import { STATUTE_LABEL_KEY } from "@/lib/manage/labels";
import {
  effectiveRetentionYears,
  offboardConfirmLines,
} from "@/lib/manage/offboarding";
import { formatWeeklyHours } from "@/lib/schedule/hours";
import { createClient } from "@/lib/supabase/server";

import { signOutEverywhereAction } from "../../team/actions";
import {
  offboardEmployeeAction,
  reinstateEmployeeAction,
  setEmployeePinAction,
} from "./actions";

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
    .select("id, display_name, employee_code, statute, user_id, left_at, anonymised_at")
    .eq("id", id)
    .maybeSingle();
  if (employeeError) throw new Error(`employee_unavailable:${employeeError.code}`);
  if (!employee) notFound();

  const { data: assignmentRows, error: assignmentsError } = await supabase
    .from("site_assignments")
    .select("site_id")
    .eq("employee_id", employee.id);
  if (assignmentsError) {
    throw new Error(`site_assignments_unavailable:${assignmentsError.code}`);
  }
  const { data: siteRows, error: sitesError } =
    assignmentRows.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("sites")
          .select("name")
          .in(
            "id",
            assignmentRows.map((row) => row.site_id),
          )
          .order("name");
  if (sitesError) throw new Error(`sites_unavailable:${sitesError.code}`);

  const isOrgAdmin =
    context.membership.role === "owner" || context.membership.role === "admin";
  const isSelf = context.employeeId === employee.id;

  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", context.membership.organizationId)
    .maybeSingle();
  if (organizationError) {
    throw new Error(`organization_unavailable:${organizationError.code}`);
  }

  // Owners and admins can read the role (managers cannot, and the database
  // refuses for them anyway): an owner is never offered "Uit dienst".
  const { data: targetMembership } =
    isOrgAdmin && employee.user_id
      ? await supabase
          .from("memberships")
          .select("role")
          .eq("organization_id", context.membership.organizationId)
          .eq("user_id", employee.user_id)
          .maybeSingle()
      : { data: null };
  const canOffboard = !isSelf && targetMembership?.role !== "owner";

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

  const name = employee.display_name;
  const plannedMinutes = scheduleRows.reduce(
    (total, row) => total + (Date.parse(row.end_at) - Date.parse(row.start_at)) / 60_000,
    0,
  );
  const inService = employee.left_at === null && employee.anonymised_at === null;
  const subtitle = [
    employee.employee_code ?? t("manageEmployee.noCode"),
    t(STATUTE_LABEL_KEY[employee.statute] ?? "manageTeam.statuteOther"),
    siteRows.map((site) => site.name).join(", ") || null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ManageShell active="team">
      <PageHeader
        back={<BackLink href="/manage/team" label={t("manageTeam.heading")} />}
        title={name}
        subtitle={
          <span className="flex flex-col gap-2">
            <span>{subtitle}</span>
            <StatusLine
              size="sm"
              tone={inService ? "working" : "off"}
              label={
                inService
                  ? t("manageEmployee.statusInService")
                  : t("manageTeam.statusLeft")
              }
            />
          </span>
        }
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-headline">{t("manageEmployee.shiftsHeading")}</h2>
        <ShiftList shifts={shifts} showOfflineSkew />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-headline">{t("manageEmployee.scheduleHeading")}</h2>
        <GroupedList
          heading={t("manageEmployee.upcomingHeading")}
          headingLevel={3}
          footer={
            scheduleRows.length > 0
              ? t("manageEmployee.scheduleSummaryHours", {
                  hours: formatWeeklyHours(plannedMinutes),
                })
              : t("manageEmployee.noSchedule")
          }
        >
          {scheduleRows.map((row, index) => (
            <ListRow
              key={index}
              title={formatBrusselsShortDate(new Date(row.start_at))}
              value={`${formatBrusselsTime(new Date(row.start_at))}–${formatBrusselsTime(new Date(row.end_at))}`}
            />
          ))}
          <ListLinkRow
            href={`/manage/medewerker/${employee.id}/rooster`}
            title={t("manageEmployee.scheduleEditLink")}
          />
        </GroupedList>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-headline">{t("manageEmployee.correctionsHeading")}</h2>
        {correctionRows.length === 0 ? (
          <p className="text-body text-ink-2">{t("manageEmployee.noCorrections")}</p>
        ) : (
          <GroupedList>
            {correctionRows.map((row) => (
              <ListRow
                key={row.id}
                title={formatBrusselsDate(new Date(row.created_at))}
                detail={[
                  row.reason,
                  row.decision_note
                    ? t("questions.managerNote", { note: row.decision_note })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                value={t(STATUS_LABEL_KEY[row.status] ?? "questions.statusPending")}
              />
            ))}
          </GroupedList>
        )}
      </section>

      {inService || isOrgAdmin ? (
        <GroupedList
          heading={t("kiosk.pinSettingsHeading")}
          footer={isOrgAdmin ? t("manageEmployee.subjectExportIntro") : undefined}
        >
          {inService ? (
            <PinRow
              employeeName={name}
              state={
                pinRow
                  ? t("kiosk.managerPinSetAt", {
                      date: formatBrusselsDate(new Date(pinRow.set_at)),
                    })
                  : t("kiosk.managerPinNone")
              }
              action={setEmployeePinAction.bind(null, employee.id)}
            />
          ) : null}
          {isOrgAdmin ? (
            <ListLinkRow
              href={`/manage/medewerker/${employee.id}/inzage`}
              download
              title={t("manageEmployee.subjectExportLink")}
            />
          ) : null}
        </GroupedList>
      ) : null}

      <GroupedList
        heading={t("manageEmployee.employmentHeading")}
        footer={
          employee.anonymised_at
            ? t("manageEmployee.anonymised")
            : employee.left_at
              ? t("manageEmployee.leftSince", {
                  date: formatBrusselsDate(new Date(`${employee.left_at}T12:00:00Z`)),
                })
              : t("manageEmployee.inService", { name })
        }
      >
        {inService && employee.user_id ? (
          <SignOutEverywhereRow
            employeeId={employee.id}
            employeeName={name}
            action={signOutEverywhereAction}
          />
        ) : null}
        {employee.anonymised_at ? null : employee.left_at ? (
          <ReinstateRow
            employeeName={name}
            action={reinstateEmployeeAction.bind(null, employee.id)}
          />
        ) : canOffboard ? (
          <OffboardRow
            employeeName={name}
            lines={offboardConfirmLines({
              name,
              hasLogin: employee.user_id !== null,
              hasPin: pinRow !== null,
              retentionYears: effectiveRetentionYears(organization?.settings),
            })}
            action={offboardEmployeeAction.bind(null, employee.id)}
          />
        ) : null}
      </GroupedList>
    </ManageShell>
  );
}
