import { redirect } from "next/navigation";

import { t } from "@cloxa/i18n";

import { OrgSettingsForm } from "@/components/manage/OrgSettingsForm";
import { List } from "@/components/ui/List";
import { NavBar } from "@/components/ui/NavBar";
import { PageTransition } from "@/components/ui/PageTransition";
import { requireManager } from "@/lib/auth/context";
import { previewHold } from "@/lib/preview";
import { currentSettings } from "@/lib/manage/settings-form";
import { createClient } from "@/lib/supabase/server";

import { updateSettingsAction } from "./actions";

/** Owners and admins: retention, offline clocking and the correction window. */
export default async function ManageSettingsPage() {
  const context = await requireManager();
  if (context.membership.role !== "owner" && context.membership.role !== "admin") {
    redirect("/manage/meer");
  }
  await previewHold();
  const supabase = await createClient();

  const organizationResult = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", context.membership.organizationId)
    .maybeSingle();
  if (organizationResult.error) {
    throw new Error(`organization_unavailable:${organizationResult.error.code}`);
  }

  return (
    <PageTransition>
      <NavBar
        title={t("orgSettings.heading")}
        subtitle={t("orgSettings.intro")}
        back={{ href: "/manage/meer", label: t("manageMore.heading") }}
      />
      <List className="pb-10">
        <OrgSettingsForm
          initial={currentSettings(organizationResult.data?.settings)}
          action={updateSettingsAction}
        />
      </List>
    </PageTransition>
  );
}
