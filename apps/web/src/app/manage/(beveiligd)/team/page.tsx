import { t, type CatalogKey } from "@cloxa/i18n";

import { InviteSheet } from "@/components/manage/InviteSheet";
import { ManageShell } from "@/components/manage/ManageShell";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { GroupedList, ListLinkRow, ListRow } from "@/components/ui/GroupedList";
import { IconSearch } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentedLinks } from "@/components/ui/SegmentedControl";
import { StatusLine, type StatusTone } from "@/components/ui/StatusLine";
import { inputClassName } from "@/components/ui/TextInput";
import { cx } from "@/components/ui/cx";
import { requireManager } from "@/lib/auth/context";
import { STATUTE_LABEL_KEY } from "@/lib/manage/labels";
import { createClient } from "@/lib/supabase/server";

import { inviteMemberAction, revokeInvitationAction } from "./actions";

const STATUS_LABEL_KEY: Record<string, CatalogKey> = {
  active: "manageTeam.statusActive",
  invited: "manageTeam.statusInvited",
  suspended: "manageTeam.statusSuspended",
  left: "manageTeam.statusLeft",
};

const STATUS_TONE: Record<string, StatusTone> = {
  active: "working",
  invited: "break",
  suspended: "danger",
  left: "off",
};

/** `?toon=`: who is in service (default), open invitations, or who left. */
const INVITED_TAB = "uitgenodigd";
const LEFT_TAB = "uit-dienst";
type Tab = "active" | "invited" | "left";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ManageTeamPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireManager();
  const params = await searchParams;
  const toon = first(params["toon"]);
  const tab: Tab = toon === LEFT_TAB ? "left" : toon === INVITED_TAB ? "invited" : "active";
  const query = (first(params["q"]) ?? "").trim().slice(0, 100);
  const supabase = await createClient();

  const { data: employeeRows, error: employeesError } = await supabase
    .from("employees")
    .select("id, display_name, employee_code, statute, user_id, active, left_at")
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
    left_at: string | null;
  }): "active" | "invited" | "suspended" | "left" {
    if (employee.left_at !== null) return "left";
    if (employee.user_id) {
      const status = membershipStatusByUser.get(employee.user_id);
      if (status === "suspended") return "suspended";
      if (status === "invited") return "invited";
      return "active";
    }
    return invitationByEmployee.has(employee.id) ? "invited" : "active";
  }

  const needle = query.toLocaleLowerCase("nl-BE");
  const matches = (...texts: (string | null | undefined)[]) =>
    needle === "" ||
    texts.some((text) => text?.toLocaleLowerCase("nl-BE").includes(needle));

  // "Actief" is everyone in service, including people who haven't logged in
  // yet (their row says so); "Uitgenodigd" lists the open invitations.
  const listed = employeeRows.filter(
    (employee) =>
      (tab === "left" ? employee.left_at !== null : employee.left_at === null) &&
      matches(employee.display_name, employee.employee_code),
  );
  const employeeNames = new Map(
    employeeRows.map((employee) => [employee.id, employee.display_name]),
  );
  const invitations = invitationRows.filter((invitation) =>
    matches(employeeNames.get(invitation.employee_id), invitation.email),
  );

  const canInvitePrivilegedRoles =
    context.membership.role === "owner" || context.membership.role === "admin";

  const tabHref = (value: string | null) => {
    const search = new URLSearchParams();
    if (value) search.set("toon", value);
    if (query) search.set("q", query);
    const text = search.toString();
    return text ? `/manage/team?${text}` : "/manage/team";
  };

  return (
    <ManageShell active="team">
      <PageHeader
        title={t("manageTeam.heading")}
        trailing={
          <InviteSheet
            sites={siteRows}
            canInvitePrivilegedRoles={canInvitePrivilegedRoles}
            action={inviteMemberAction}
          />
        }
      />

      <div className="flex flex-col gap-4">
        <form method="get" role="search" className="relative flex">
          {tab !== "active" ? (
            <input type="hidden" name="toon" value={toon ?? ""} />
          ) : null}
          <label htmlFor="team-search" className="sr-only">
            {t("manageTeam.searchLabel")}
          </label>
          <IconSearch className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-2" />
          <input
            id="team-search"
            type="search"
            name="q"
            defaultValue={query}
            placeholder={t("manageTeam.searchPlaceholder")}
            autoComplete="off"
            className={cx(inputClassName, "pl-12")}
          />
        </form>
        <SegmentedLinks
          label={t("manageTeam.filterLabel")}
          items={[
            {
              key: "active",
              label: t("manageTeam.filterActive"),
              href: tabHref(null),
              current: tab === "active",
            },
            {
              key: "invited",
              label: t("manageTeam.filterInvited"),
              href: tabHref(INVITED_TAB),
              current: tab === "invited",
            },
            {
              key: "left",
              label: t("manageTeam.filterLeft"),
              href: tabHref(LEFT_TAB),
              current: tab === "left",
            },
          ]}
        />
      </div>

      {tab === "invited" ? (
        invitations.length === 0 ? (
          <EmptyState
            title={
              query
                ? t("manageTeam.noResults", { query })
                : t("manageTeam.noInvited")
            }
            body={t("manageTeam.noInvitedBody")}
          />
        ) : (
          <GroupedList>
            {invitations.map((invitation) => (
              <ListRow
                key={invitation.id}
                title={employeeNames.get(invitation.employee_id) ?? invitation.email}
                detail={t("manageTeam.invitedEmail", { email: invitation.email })}
              >
                <form action={revokeInvitationAction}>
                  <input type="hidden" name="id" value={invitation.id} />
                  <Button type="submit" variant="plain">
                    {t("manageTeam.revoke")}
                  </Button>
                </form>
              </ListRow>
            ))}
          </GroupedList>
        )
      ) : listed.length === 0 ? (
        <EmptyState
          title={
            query
              ? t("manageTeam.noResults", { query })
              : t(
                  tab === "left"
                    ? "manageTeam.noLeftEmployees"
                    : "manageTeam.noActiveEmployees",
                )
          }
          body={t("manage.emptyTeamBody")}
        />
      ) : (
        <GroupedList>
          {listed.map((employee) => {
            const status = statusOf(employee);
            const sites = (sitesByEmployee.get(employee.id) ?? []).join(", ");
            return (
              <ListLinkRow
                key={employee.id}
                href={`/manage/medewerker/${employee.id}`}
                title={employee.display_name}
                detail={[
                  sites || null,
                  t(STATUTE_LABEL_KEY[employee.statute] ?? "manageTeam.statuteOther"),
                ]
                  .filter(Boolean)
                  .join(" · ")}
                value={
                  <StatusLine
                    size="sm"
                    tone={STATUS_TONE[status] ?? "off"}
                    label={t(STATUS_LABEL_KEY[status] ?? "manageTeam.statusActive")}
                  />
                }
              />
            );
          })}
        </GroupedList>
      )}
    </ManageShell>
  );
}
