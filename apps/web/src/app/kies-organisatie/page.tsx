import { redirect } from "next/navigation";

import { t } from "@cloxa/i18n";

import { AuthShell } from "@/components/auth/AuthShell";
import { SessionActions } from "@/components/auth/SessionActions";
import { Button } from "@/components/ui/Button";
import { Stack } from "@/components/ui/Stack";
import { chooseOrganization } from "@/lib/auth/actions/session";
import { requireSignedIn } from "@/lib/auth/context";

export default async function ChooseOrganizationPage() {
  const context = await requireSignedIn();
  const memberships = context.kind === "none" ? [] : context.memberships;
  if (memberships.length < 2) redirect("/start");

  return (
    <AuthShell title={t("chooseOrg.title")}>
      <p className="text-lg">{t("chooseOrg.intro")}</p>
      <Stack as="ul" gap="md">
        {memberships.map((membership) => (
          <li key={membership.id}>
            <form action={chooseOrganization}>
              <input
                type="hidden"
                name="organizationId"
                value={membership.organizationId}
              />
              <Button type="submit" variant="secondary" size="lg">
                {membership.organizationName}
              </Button>
            </form>
          </li>
        ))}
      </Stack>
      <SessionActions />
    </AuthShell>
  );
}
