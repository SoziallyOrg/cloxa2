import { formatBrusselsDate, t, type CatalogKey } from "@cloxa/i18n";

import { InviteSheet } from "@/components/manage/InviteSheet";
import { TeamList, type TeamListRow } from "@/components/manage/TeamList";
import { NavBar } from "@/components/ui/NavBar";
import { Notice } from "@/components/ui/Notice";
import { PageTransition } from "@/components/ui/PageTransition";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { SegmentNav } from "@/components/ui/SegmentNav";
import { requireManager } from "@/lib/auth/context";
import { STATUTE_LABEL_KEY } from "@/lib/manage/labels";
import { previewHold } from "@/lib/preview";
import { createClient } from "@/lib/supabase/server";

import { inviteMemberAction, revokeInvitationAction } from "./actions";

const STATUS_LABEL_KEY: Record<string, CatalogKey> = {
  active: "manageTeam.statusActive",
  invited: "manageTeam.statusInvited",
  suspended: "manageTeam.statusSuspended",
  left: "manageTeam.statusLeft",
};

/** `?toon=`: the segment. In service (the default), open invitations, or left. */
const SEGMENTS = ["actief", "uitgenodigd", "uit-dienst"] as const;
type Segment = (typeof SEGMENTS)[number];

export default async function ManageTeamPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireManager();
  await previewHold();
  const params = await searchParams;
  const segment: Segment =
    SEGMENTS.find((candidate) => candidate === params["toon"]) ?? "actief";
  const justInvited = params["verstuurd"] === "1";
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

  function subtitleOf(employee: { id: string; statute: string }): string {
    const sites = (sitesByEmployee.get(employee.id) ?? []).join(", ");
    const statute = t(STATUTE_LABEL_KEY[employee.statute] ?? "manageTeam.statuteOther");
    return [sites, statute].filter(Boolean).join(" · ");
  }

  const employeeNames = new Map(employeeRows.map((row) => [row.id, row.display_name]));

  let rows: TeamListRow[];
  let empty: { title: string; body: string };
  if (segment === "uitgenodigd") {
    rows = invitationRows.map((invitation) => ({
      id: invitation.id,
      name: employeeNames.get(invitation.employee_id) ?? invitation.email,
      code: null,
      subtitle: t("manageTeam.invitedEmail", { email: invitation.email }),
      status: t("manageTeam.statusInvited"),
      href: null,
      invitationId: invitation.id,
    }));
    empty = { title: t("manageTeam.noInvited"), body: t("manageTeam.noInvitedBody") };
  } else {
    const left = segment === "uit-dienst";
    rows = employeeRows
      .filter((employee) =>
        left ? employee.left_at !== null : employee.left_at === null,
      )
      .map((employee) => ({
        id: employee.id,
        name: employee.display_name,
        code: employee.employee_code,
        subtitle: subtitleOf(employee),
        status:
          left && employee.left_at
            ? formatBrusselsDate(new Date(`${employee.left_at}T12:00:00Z`))
            : statusOf(employee) === "active"
              ? null
              : t(STATUS_LABEL_KEY[statusOf(employee)] ?? "manageTeam.statusActive"),
        href: `/manage/medewerker/${employee.id}`,
      }));
    empty = left
      ? { title: t("manageTeam.noLeftEmployees"), body: t("manageTeam.noLeftBody") }
      : {
          title: t("manageTeam.noActiveEmployees"),
          body: t("manageTeam.noActiveBody"),
        };
  }

  const canInvitePrivilegedRoles =
    context.membership.role === "owner" || context.membership.role === "admin";

  const segments = [
    { value: "actief", label: t("manageTeam.filterActive"), href: "/manage/team" },
    {
      value: "uitgenodigd",
      label: t("manageTeam.filterInvited"),
      href: "/manage/team?toon=uitgenodigd",
    },
    {
      value: "uit-dienst",
      label: t("manageTeam.filterLeft"),
      href: "/manage/team?toon=uit-dienst",
    },
  ] as const;

  return (
    <PageTransition>
      <PullToRefresh>
        <NavBar
          title={t("manageTeam.heading")}
          trailing={
            <InviteSheet
              sites={siteRows}
              canInvitePrivilegedRoles={canInvitePrivilegedRoles}
              action={inviteMemberAction}
            />
          }
        />
        <div className="flex flex-col gap-6 px-gutter pb-10 md:px-gutter-desktop">
          <SegmentNav
            key={segment}
            label={t("manageTeam.filterLabel")}
            options={segments}
            value={segment}
          />
          {justInvited && segment === "uitgenodigd" ? (
            <Notice tone="success">{t("manageTeam.invited")}</Notice>
          ) : null}
          <TeamList
            key={segment}
            rows={rows}
            empty={empty}
            revokeAction={revokeInvitationAction}
          />
        </div>
      </PullToRefresh>
    </PageTransition>
  );
}
