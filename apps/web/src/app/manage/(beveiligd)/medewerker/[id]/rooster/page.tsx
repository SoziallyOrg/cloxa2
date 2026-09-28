import { notFound } from "next/navigation";

import { brusselsDayKey } from "@cloxa/domain";
import { formatBrusselsDate, t } from "@cloxa/i18n";
import type { SchedulePattern } from "@cloxa/db";

import { ScheduleEditor } from "@/components/manage/ScheduleEditor";
import { List, Row, Section } from "@/components/ui/List";
import { NavBar } from "@/components/ui/NavBar";
import { PageTransition } from "@/components/ui/PageTransition";
import { requireManager } from "@/lib/auth/context";
import { previewHold } from "@/lib/preview";
import { nowMs } from "@/lib/clock/now";
import { patternToFormState } from "@/lib/schedule/form-state";
import { formatWeeklyHours, weeklyMinutes } from "@/lib/schedule/hours";
import { nextMonday } from "@/lib/schedule/lead-time";
import { createClient } from "@/lib/supabase/server";

import { setScheduleAction } from "./actions";

export default async function ManageEmployeeSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireManager();
  await previewHold();
  const { id } = await params;
  const supabase = await createClient();

  const { data: employee, error: employeeError } = await supabase
    .from("employees")
    .select("id, display_name")
    .eq("id", id)
    .maybeSingle();
  if (employeeError) throw new Error(`employee_unavailable:${employeeError.code}`);
  if (!employee) notFound();

  const { data: versionRows, error: versionsError } = await supabase
    .from("schedules")
    .select("id, version, valid_from, pattern, created_by, created_at")
    .eq("employee_id", employee.id)
    .order("valid_from", { ascending: false })
    .order("version", { ascending: false });
  if (versionsError) throw new Error(`schedules_unavailable:${versionsError.code}`);

  const now = nowMs();
  const todayKey = brusselsDayKey(now);
  const currentVersion =
    versionRows.find((row) => row.valid_from <= todayKey) ?? versionRows[0] ?? null;
  const initialForm = patternToFormState(
    (currentVersion?.pattern as SchedulePattern | undefined) ?? null,
  );

  // Best-effort: the creator's display name only resolves when they're also
  // an employee in this organization (managers who are also staff).
  const creatorIds = [...new Set(versionRows.map((row) => row.created_by))];
  const { data: creatorRows } =
    creatorIds.length === 0
      ? { data: [] }
      : await supabase
          .from("employees")
          .select("user_id, display_name")
          .in("user_id", creatorIds);
  const creatorNames = new Map(
    (creatorRows ?? [])
      .filter((row) => row.user_id !== null)
      .map((row) => [row.user_id as string, row.display_name]),
  );

  const boundAction = setScheduleAction.bind(null, employee.id);

  return (
    <PageTransition>
      <NavBar
        title={t("schedule.heading")}
        subtitle={employee.display_name}
        back={{
          href: `/manage/medewerker/${employee.id}`,
          label: employee.display_name,
        }}
      />
      <List className="pb-10">
        <ScheduleEditor
          initialForm={initialForm}
          todayKey={todayKey}
          defaultValidFrom={nextMonday(todayKey)}
          action={boundAction}
        />

        {versionRows.length > 0 ? (
          <Section header={t("schedule.historyHeading")}>
            {versionRows.map((row) => {
              const hours = formatWeeklyHours(
                weeklyMinutes(patternToFormState(row.pattern as SchedulePattern)),
              );
              const creatorName = creatorNames.get(row.created_by);
              return (
                <Row
                  key={row.id}
                  title={t("schedule.historyRow", {
                    date: formatBrusselsDate(new Date(`${row.valid_from}T12:00:00Z`)),
                    hours,
                  })}
                  subtitle={
                    creatorName
                      ? t("schedule.historyCreatedBy", { name: creatorName })
                      : undefined
                  }
                />
              );
            })}
          </Section>
        ) : null}
      </List>
    </PageTransition>
  );
}
