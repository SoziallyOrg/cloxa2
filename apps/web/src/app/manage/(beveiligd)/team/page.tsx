import Link from "next/link";
import type { Route } from "next";

import { t, type CatalogKey } from "@cloxa/i18n";

import { InviteForm } from "@/components/manage/InviteForm";
import { ManageShell } from "@/components/manage/ManageShell";
import { SignOutEverywhereForm } from "@/components/manage/SignOutEverywhereForm";
import { Heading } from "@/components/ui/Heading";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { requireManager } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

import {
  inviteMemberAction,
  revokeInvitationAction,
  signOutEverywhereAction,
} from "./actions";

const STATUTE_LABEL_KEY: Record<string, CatalogKey> = {
  bediende: "manageTeam.statuteBediende",
  arbeider: "manageTeam.statuteArbeider",
  student: "manageTeam.statuteStudent",
  flexi: "manageTeam.statuteFlexi",
  interim: "manageTeam.statuteInterim",
  other: "manageTeam.statuteOther",
};

const STATUS_LABEL_KEY: Record<string, CatalogKey> = {
  active: "manageTeam.statusActive",
  invited: "manageTeam.statusInvited",
  suspended: "manageTeam.statusSuspended",
};

const STATUS_TONE: Record<string, StatusTone> = {
  active: "working",
  invited: "break",
  suspended: "error",
};

export default async function ManageTeamPage() {
  const context = await requireManager();
  const supabase = await createClient();

  const { count: pendingCount } = await supabase
    .from("correction_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  const { data: employeeRows, error: employeesError } = await supabase
    .from("employees")
    .select("id, display_name, employee_code, statute, user_id, active")
    .order("display_name");
  if (employeesError) throw new Error(`employees_unavailable:${employeesError.code}`);

  const { data: siteRows, error: sitesError } = await supabase
    .from("sites")
    .select("id, name")
    .eq("active", true)
    .order("name");
  if (sitesError) throw new Error(`sites_unavailable:${sitesError.code}`);

  const { data: assignmentRows, error: assignmentsError } = await supabase
    .from("site_assignments")
    .select("employee_id, site_id")
    .not("employee_id", "is", null);
  if (assignmentsError) {
    throw new Error(`site_assignments_unavailable:${assignmentsError.code}`);
  }
  const siteNames = new Map(siteRows.map((site) => [site.id, site.name]));
  const sitesByEmployee = new Map<string, string[]>();
  for (const row of assignmentRows) {
    if (row.employee_id === null) continue;
    const list = sitesByEmployee.get(row.employee_id) ?? [];
    const name = siteNames.get(row.site_id);
    if (name) list.push(name);
    sitesByEmployee.set(row.employee_id, list);
  }

  const userIds = employeeRows
    .map((employee) => employee.user_id)
    .filter((id): id is string => id !== null);
  const { data: membershipRows, error: membershipsError } =
    userIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("memberships")
          .select("user_id, status")
          .in("user_id", userIds);
  if (membershipsError) {
    throw new Error(`memberships_unavailable:${membershipsError.code}`);
  }
  const membershipStatusByUser = new Map(
    membershipRows.map((row) => [row.user_id, row.status]),
  );

  // "linked" invitations (the auth user exists but hasn't accepted yet) are
  // still outstanding, exactly like "pending" ones elsewhere in the schema
  // (see the invitations' own uniqueness checks).
  const { data: invitationRows, error: invitationsError } = await supabase
    .from("invitations")
    .select("id, employee_id, email, role, created_at")
    .in("status", ["pending", "linked"])
    .order("created_at", { ascending: true });
  if (invitationsError) {
    throw new Error(`invitations_unavailable:${invitationsError.code}`);
  }
  const invitationByEmployee = new Map(
    invitationRows.map((invitation) => [invitation.employee_id, invitation]),
  );

  function statusOf(employee: {
    user_id: string | null;
    id: string;
  }): "active" | "invited" | "suspended" {
    if (employee.user_id) {
      const status = membershipStatusByUser.get(employee.user_id);
      if (status === "suspended") return "suspended";
      if (status === "invited") return "invited";
      return "active";
    }
    return invitationByEmployee.has(employee.id) ? "invited" : "active";
  }

  const canInvitePrivilegedRoles =
    context.membership.role === "owner" || context.membership.role === "admin";

  return (
    <ManageShell
      active="team"
      pendingQuestionsCount={pendingCount ?? 0}
      showSwitchToEmployee={context.employeeId !== null}
    >
      <div className="flex flex-col gap-8">
        <Heading level={1}>{t("manageTeam.heading")}</Heading>

        <section className="flex flex-col gap-4">
          <Heading level={2}>{t("manageTeam.employeesHeading")}</Heading>
          <ul className="flex flex-col gap-3">
            {employeeRows.map((employee) => {
              const status = statusOf(employee);
              return (
                <li
                  key={employee.id}
                  className="flex flex-col gap-2 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex flex-col gap-1">
                    <Link
                      href={`/manage/medewerker/${employee.id}` as Route}
                      className="focus-ring text-lg font-semibold text-primary underline"
                    >
                      {employee.display_name}
                    </Link>
                    <span className="text-ink/70">
                      {employee.employee_code ?? "—"} ·{" "}
                      {t(
                        STATUTE_LABEL_KEY[employee.statute] ??
                          "manageTeam.statuteOther",
                      )}
                      {" · "}
                      {(sitesByEmployee.get(employee.id) ?? []).join(", ") || "—"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge
                      tone={STATUS_TONE[status] ?? "off"}
                      label={t(STATUS_LABEL_KEY[status] ?? "manageTeam.statusActive")}
                    />
                    {employee.user_id ? (
                      <SignOutEverywhereForm
                        employeeId={employee.id}
                        employeeName={employee.display_name}
                        action={signOutEverywhereAction}
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="flex flex-col gap-4">
          <Heading level={2}>{t("manageTeam.pendingInvitesHeading")}</Heading>
          {invitationRows.length === 0 ? (
            <p className="text-ink/70">{t("manageTeam.noPendingInvites")}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {invitationRows.map((invitation) => (
                <li
                  key={invitation.id}
                  className="flex flex-col gap-2 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span>{invitation.email}</span>
                  <form action={revokeInvitationAction}>
                    <input type="hidden" name="id" value={invitation.id} />
                    <Button type="submit" variant="quiet" size="md">
                      {t("manageTeam.revoke")}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="max-w-xl rounded-lg border border-border p-4">
          <InviteForm
            sites={siteRows}
            canInvitePrivilegedRoles={canInvitePrivilegedRoles}
            action={inviteMemberAction}
          />
        </section>
      </div>
    </ManageShell>
  );
}
