import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";

import { t } from "@cloxa/i18n";

import { ManageShell } from "@/components/manage/ManageShell";
import { OrgSettingsForm } from "@/components/manage/OrgSettingsForm";
import { Heading } from "@/components/ui/Heading";
import { requireManager } from "@/lib/auth/context";
import { currentSettings } from "@/lib/manage/settings-form";
import { createClient } from "@/lib/supabase/server";

import { updateSettingsAction } from "./actions";

/** Owners and admins: retention, offline clocking and the correction window. */
export default async function ManageSettingsPage() {
  const context = await requireManager();
  if (context.membership.role !== "owner" && context.membership.role !== "admin") {
    redirect("/manage/meer");
  }
  const supabase = await createClient();

  const [pending, organizationResult] = await Promise.all([
    supabase
      .from("correction_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("organizations")
      .select("settings")
      .eq("id", context.membership.organizationId)
      .maybeSingle(),
  ]);
  if (organizationResult.error) {
    throw new Error(`organization_unavailable:${organizationResult.error.code}`);
  }

  return (
    <ManageShell
      active="more"
      pendingQuestionsCount={pending.count ?? 0}
      showSwitchToEmployee={context.employeeId !== null}
    >
      <div className="flex max-w-xl flex-col gap-6">
        <Link
          href={"/manage/meer" as Route}
          className="focus-ring self-start font-semibold text-primary underline"
        >
          {t("common.back")}
        </Link>
        <Heading level={1}>{t("orgSettings.heading")}</Heading>
        <p className="text-lg">{t("orgSettings.intro")}</p>
        <OrgSettingsForm
          initial={currentSettings(organizationResult.data?.settings)}
          action={updateSettingsAction}
        />
      </div>
    </ManageShell>
  );
}
