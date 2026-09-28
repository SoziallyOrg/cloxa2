import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";

import { brusselsDayKey } from "@cloxa/domain";
import { t } from "@cloxa/i18n";
import type { SchedulePattern } from "@cloxa/db";

import { ManageShell } from "@/components/manage/ManageShell";
import { ScheduleEditor } from "@/components/manage/ScheduleEditor";
import { Heading } from "@/components/ui/Heading";
import { requireManager } from "@/lib/auth/context";
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
  const context = await requireManager();
  const { id } = await params;
  const supabase = await createClient();

  const { data: employee, error: employeeError } = await supabase
    .from("employees")
    .select("id, display_name")
    .eq("id", id)
    .maybeSingle();
  if (employeeError) throw new Error(`employee_unavailable:${employeeError.code}`);
  if (!employee) notFound();

  const { count: pendingCount } = await supabase
    .from("correction_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

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
    <ManageShell
      active="team"
      pendingQuestionsCount={pendingCount ?? 0}
      showSwitchToEmployee={context.employeeId !== null}
    >
      <div className="flex flex-col gap-8">
        <Link
          href={`/manage/medewerker/${employee.id}` as Route}
          className="focus-ring self-start font-semibold text-ink underline"
        >
          {t("schedule.backLink")}
        </Link>
        <Heading level={1}>{employee.display_name}</Heading>
        <Heading level={2}>{t("schedule.heading")}</Heading>

        <ScheduleEditor
          initialForm={initialForm}
          todayKey={todayKey}
          defaultValidFrom={nextMonday(todayKey)}
          action={boundAction}
        />

        <section className="flex flex-col gap-3">
          <Heading level={2}>{t("schedule.historyHeading")}</Heading>
          {versionRows.length === 0 ? (
            <p className="text-ink-2">{t("schedule.noHistory")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {versionRows.map((row) => {
                const hours = formatWeeklyHours(
                  weeklyMinutes(patternToFormState(row.pattern as SchedulePattern)),
                );
                const creatorName = creatorNames.get(row.created_by);
                return (
                  <li key={row.id} className="rounded-lg border border-line p-4">
                    <p className="font-semibold">
                      {t("schedule.historyRow", { date: row.valid_from, hours })}
                    </p>
                    {creatorName ? (
                      <p className="text-ink-2">
                        {t("schedule.historyCreatedBy", { name: creatorName })}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </ManageShell>
  );
}
