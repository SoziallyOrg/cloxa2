import { redirect } from "next/navigation";

import { t } from "@cloxa/i18n";

import { AuthShell } from "@/components/auth/AuthShell";
import { SessionActions } from "@/components/auth/SessionActions";
import { GroupedList, ListButtonRow } from "@/components/ui/GroupedList";
import { chooseOrganization } from "@/lib/auth/actions/session";
import { requireSignedIn } from "@/lib/auth/context";

export default async function ChooseOrganizationPage() {
  const context = await requireSignedIn();
  const memberships = context.kind === "none" ? [] : context.memberships;
  if (memberships.length < 2) redirect("/start");

  return (
    <AuthShell
      title={t("chooseOrg.title")}
      intro={<p className="text-body text-ink-2">{t("chooseOrg.intro")}</p>}
    >
      {/* One form per organization; the rows submit them via `form=` (a form can't sit in a list). */}
      {memberships.map((membership) => (
        <form
          key={membership.id}
          id={`org-${membership.id}`}
          action={chooseOrganization}
          hidden
        >
          <input
            type="hidden"
            name="organizationId"
            value={membership.organizationId}
          />
        </form>
      ))}
      <GroupedList>
        {memberships.map((membership) => (
          <ListButtonRow
            key={membership.id}
            type="submit"
            form={`org-${membership.id}`}
            title={membership.organizationName}
            chevron
          />
        ))}
      </GroupedList>
      <SessionActions />
    </AuthShell>
  );
}
