import { notFound } from "next/navigation";
import { CalendarDays, Download } from "lucide-react";

import { scheduleFor } from "@cloxa/db";
import { brusselsDayKey, deriveShifts, effectiveEvents } from "@cloxa/domain";
import {
  formatBrusselsDate,
  formatBrusselsShortDate,
  formatBrusselsTime,
  t,
  type CatalogKey,
} from "@cloxa/i18n";

import { fieldsToForm, fieldValue, modulesFor, type ModuleId } from "@cloxa/modules";

import { formatDurationMs } from "@/components/clock/format";
import { formatShiftRow } from "@/components/clock/shift-row";
import { ShiftTags } from "@/components/clock/ShiftTags";
import { workedMs } from "@/components/clock/week-total";
import { ModuleFieldsSheet } from "@/components/modules/ModuleFieldsSheet";
import { ModuleSection } from "@/components/modules/ModuleSection";
import {
  OffboardSection,
  PinSection,
  ReinstateSection,
  SignOutSection,
} from "@/components/manage/EmploymentActions";
import { List, ListItem, Row, Section } from "@/components/ui/List";
import { NavBar } from "@/components/ui/NavBar";
import { PageTransition } from "@/components/ui/PageTransition";
import { StatusLine } from "@/components/ui/StatusLine";
import { requireManager } from "@/lib/auth/context";
import { nowMs } from "@/lib/clock/now";
import { STATUTE_LABEL_KEY } from "@/lib/manage/labels";
import { CLOCK_EVENT_COLUMNS, clockEventFromRow } from "@/lib/modules/events";
import { loadEnabledModules, loadModuleData, loadYearFacts } from "@/lib/modules/load";
import { renderValue, viewModule } from "@/lib/modules/message";
import {
  effectiveRetentionYears,
  offboardConfirmLines,
} from "@/lib/manage/offboarding";
import { previewHold } from "@/lib/preview";
import { formatWeeklyHours } from "@/lib/schedule/hours";
import { createClient } from "@/lib/supabase/server";

import { signOutEverywhereAction } from "../../team/actions";
import {
  offboardEmployeeAction,
  reinstateEmployeeAction,
  setEmployeePinAction,
  setModuleFieldsAction,
} from "./actions";

const DAY_MS = 24 * 3600 * 1000;
const WINDOW_DAYS = 14;
const WINDOW_MS = WINDOW_DAYS * DAY_MS;
const FETCH_BUFFER_MS = DAY_MS;
const SCHEDULE_DAYS_AHEAD = 6;

const STATUS_LABEL_KEY: Record<string, CatalogKey> = {
  pending: "questions.statusPending",
  approved: "questions.statusApproved",
  rejected: "questions.statusRejected",
  withdrawn: "questions.statusWithdrawn",
};

const range = (from: string, to: string) =>
  `${formatBrusselsTime(new Date(from))}–${formatBrusselsTime(new Date(to))}`;

export default async function ManageEmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await requireManager();
  await previewHold();
  const { id } = await params;
  const supabase = await createClient();

  const { data: employee, error: employeeError } = await supabase
    .from("employees")
    .select("id, display_name, employee_code, statute, user_id, left_at, anonymised_at")
    .eq("id", id)
    .maybeSingle();
  if (employeeError) throw new Error(`employee_unavailable:${employeeError.code}`);
  if (!employee) notFound();

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
    .select(CLOCK_EVENT_COLUMNS)
    .eq("employee_id", employee.id)
    .gte("occurred_at", new Date(windowStart - FETCH_BUFFER_MS).toISOString())
    .order("occurred_at");
  if (eventsError) throw new Error(`clock_events_unavailable:${eventsError.code}`);

  const shifts = deriveShifts(effectiveEvents(eventRows.map(clockEventFromRow)))
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
  const toKey = brusselsDayKey(now + SCHEDULE_DAYS_AHEAD * DAY_MS);
  const [scheduleRows, assignmentsResult, sitesResult] = await Promise.all([
    scheduleFor(supabase, { employeeId: employee.id, from: todayKey, to: toKey }),
    supabase.from("site_assignments").select("site_id").eq("employee_id", employee.id),
    supabase.from("sites").select("id, name").order("name"),
  ]);
  // The header is a nicety: unreadable sites leave the names out.
  const assigned = new Set((assignmentsResult.data ?? []).map((row) => row.site_id));
  const siteNames = (sitesResult.data ?? [])
    .filter((site) => assigned.has(site.id))
    .map((site) => site.name);

  const header = [
    employee.employee_code ?? t("manageEmployee.noCode"),
    t(STATUTE_LABEL_KEY[employee.statute] ?? "manageTeam.statuteOther"),
    siteNames.join(", "),
  ]
    .filter(Boolean)
    .join(" · ");

  // The next 7 days, each with its blocks or "Vrij".
  const upcoming = Array.from({ length: SCHEDULE_DAYS_AHEAD + 1 }, (_, offset) => {
    const at = now + offset * DAY_MS;
    const key = brusselsDayKey(at);
    const blocks = scheduleRows.filter(
      (row) => brusselsDayKey(Date.parse(row.start_at)) === key,
    );
    return {
      key,
      label: formatBrusselsShortDate(new Date(at)),
      value:
        blocks.length === 0
          ? t("manageEmployee.dayOff")
          : blocks.map((row) => range(row.start_at, row.end_at)).join(", "),
    };
  });
  const plannedMinutes = scheduleRows.reduce(
    (total, row) =>
      total + (Date.parse(row.end_at) - Date.parse(row.start_at)) / 60_000,
    0,
  );
  // Modules (ADR 008): only the enabled ones that apply to this statute.
  const applicable = modulesFor(
    await loadEnabledModules(supabase, context.membership.organizationId),
    employee.statute,
  );
  const [facts, moduleData] =
    applicable.length === 0
      ? [null, new Map<ModuleId, unknown>()]
      : await Promise.all([
          loadYearFacts(supabase, employee.id, now),
          loadModuleData(supabase, employee.id),
        ]);
  const moduleSections = facts
    ? applicable.map(({ module, config }) => ({
        module,
        data: moduleData.get(module.id) ?? null,
        view: viewModule(module, {
          ...facts,
          config,
          data: moduleData.get(module.id) ?? null,
          audience: "manager",
        }),
      }))
    : [];

  const leftDate = employee.left_at
    ? formatBrusselsDate(new Date(`${employee.left_at}T12:00:00Z`))
    : null;

  return (
    <PageTransition>
      <NavBar
        title={employee.display_name}
        subtitle={
          <span className="flex flex-col gap-1.5">
            <span>{header}</span>
            {leftDate ? (
              <StatusLine size="sm" tone="off" label={t("manageEmployee.statusLeft")} />
            ) : (
              <StatusLine
                size="sm"
                tone="working"
                label={t("manageEmployee.statusInService")}
              />
            )}
          </span>
        }
        back={{ href: "/manage/team", label: t("manageTeam.heading") }}
      />
      <List className="pb-10">
        <Section header={t("manageEmployee.shiftsHeading")}>
          {shifts.length === 0 ? (
            <ListItem className="text-body text-ink-2">
              {t("manageEmployee.noShifts")}
            </ListItem>
          ) : (
            shifts.map((shift) => {
              const row = formatShiftRow(shift);
              return (
                <Row
                  key={shift.start}
                  title={row.date}
                  subtitle={
                    <ShiftTags
                      range={row.range}
                      edited={row.edited}
                      offline={row.offline}
                      home={shift.workLocation === "home"}
                      extra={
                        row.offlineSkew
                          ? t("offline.skewLabel", { value: row.offlineSkew })
                          : null
                      }
                    />
                  }
                  value={
                    !shift.open
                      ? row.net
                      : brusselsDayKey(shift.start) === todayKey
                        ? formatDurationMs(workedMs(shift, now))
                        : // Left open since an earlier day: no running total.
                          t("common.none")
                  }
                />
              );
            })
          )}
        </Section>

        {correctionRows.length > 0 ? (
          <Section header={t("manageEmployee.correctionsHeading")}>
            {correctionRows.map((row) => (
              <Row
                key={row.id}
                title={formatBrusselsDate(new Date(row.created_at))}
                subtitle={
                  [
                    row.reason,
                    row.decision_note
                      ? t("questions.managerNote", { note: row.decision_note })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || undefined
                }
                value={t(STATUS_LABEL_KEY[row.status] ?? "questions.statusPending")}
              />
            ))}
          </Section>
        ) : null}

        <Section
          header={t("manageEmployee.upcomingHeading")}
          footer={
            scheduleRows.length > 0
              ? t("manageEmployee.scheduleSummaryHours", {
                  hours: formatWeeklyHours(plannedMinutes),
                })
              : t("manageEmployee.noSchedule")
          }
        >
          {upcoming.map((day) => (
            <Row key={day.key} title={day.label} value={day.value} />
          ))}
          <Row
            href={`/manage/medewerker/${employee.id}/rooster`}
            icon={CalendarDays}
            title={t("manageEmployee.scheduleEditLink")}
          />
        </Section>

        {moduleSections.map(({ module, data, view }) => (
          <ModuleSection key={module.id} view={view}>
            {module.fields.length > 0
              ? module.fields.map((field) => {
                  const value = fieldValue(field, data);
                  return (
                    <Row
                      key={field.key}
                      // A field name can be long: it wraps instead of hiding.
                      wrap
                      title={t(field.label)}
                      value={
                        value === null ? t("modules.fieldNotSet") : renderValue(value)
                      }
                    />
                  );
                })
              : undefined}
            {module.fields.length > 0 && !employee.anonymised_at ? (
              <ModuleFieldsSheet
                moduleId={module.id}
                moduleLabel={view.label}
                employeeName={employee.display_name}
                fields={module.fields}
                initial={fieldsToForm(module, data)}
                action={setModuleFieldsAction.bind(null, employee.id, module.id)}
              />
            ) : null}
          </ModuleSection>
        ))}

        {employee.anonymised_at ? null : (
          <PinSection
            employeeName={employee.display_name}
            stateLabel={pinRow ? t("kiosk.pinStateSet") : t("kiosk.pinStateNotSet")}
            footer={
              pinRow
                ? t("kiosk.managerPinSetAt", {
                    date: formatBrusselsDate(new Date(pinRow.set_at)),
                  })
                : t("kiosk.managerPinNone")
            }
            action={setEmployeePinAction.bind(null, employee.id)}
          />
        )}

        {isOrgAdmin ? (
          <Section footer={t("manageEmployee.subjectExportIntro")}>
            <Row
              href={`/manage/medewerker/${employee.id}/inzage`}
              download
              icon={Download}
              title={t("manageEmployee.subjectExportLink")}
              subtitle={t("manageEmployee.subjectExportFormat")}
            />
          </Section>
        ) : null}

        {employee.user_id && !leftDate ? (
          <SignOutSection
            employeeId={employee.id}
            employeeName={employee.display_name}
            action={signOutEverywhereAction}
          />
        ) : null}

        {employee.anonymised_at ? (
          <p className="px-4 text-subhead text-ink-2">
            {t("manageEmployee.anonymised")}
          </p>
        ) : leftDate ? (
          <ReinstateSection
            employeeName={employee.display_name}
            footer={
              <span className="flex flex-col gap-1">
                <span>{t("manageEmployee.leftSince", { date: leftDate })}</span>
                <span>{t("manageEmployee.reinstateNote")}</span>
              </span>
            }
            action={reinstateEmployeeAction.bind(null, employee.id)}
          />
        ) : (
          <OffboardSection
            employeeName={employee.display_name}
            footer={t("manageEmployee.inService", { name: employee.display_name })}
            canOffboard={canOffboard}
            lines={offboardConfirmLines({
              name: employee.display_name,
              hasLogin: employee.user_id !== null,
              hasPin: pinRow !== null,
              retentionYears: effectiveRetentionYears(organization?.settings),
            })}
            action={offboardEmployeeAction.bind(null, employee.id)}
          />
        )}
      </List>
    </PageTransition>
  );
}
