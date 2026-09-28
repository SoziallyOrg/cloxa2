import Link from "next/link";
import type { Route } from "next";

import { t } from "@cloxa/i18n";

import { SessionActions } from "@/components/auth/SessionActions";
import { ManageShell } from "@/components/manage/ManageShell";
import { Heading } from "@/components/ui/Heading";
import { Stack } from "@/components/ui/Stack";
import { requireManager } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

export default async function ManageMeerPage() {
  const context = await requireManager();
  const supabase = await createClient();

  const { count: pendingCount } = await supabase
    .from("correction_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  return (
    <ManageShell
      active="more"
      pendingQuestionsCount={pendingCount ?? 0}
      showSwitchToEmployee={context.employeeId !== null}
    >
      <Stack gap="lg">
        <Heading level={1}>{t("manageMore.heading")}</Heading>
        <Stack gap="md" as="ul">
          <li>
            <Link
              href={"/manage/meer/exports" as Route}
              className="focus-ring text-lg font-semibold text-primary underline"
            >
              {t("exports.moreLink")}
            </Link>
          </li>
          <li className="text-lg text-ink/70">{t("manageMore.settings")}</li>
          <li>
            <Link
              href={"/manage/beveiliging/instellen" as Route}
              className="focus-ring text-lg font-semibold text-primary underline"
            >
              {t("manageMore.security")}
            </Link>
          </li>
        </Stack>
        {context.employeeId !== null ? (
          <Link
            href={"/app" as Route}
            className="focus-ring inline-flex min-h-touch-target w-fit items-center rounded-md border-2 border-primary px-6 text-lg font-semibold text-primary"
          >
            {t("manageNav.switchToEmployee")}
          </Link>
        ) : null}
        <SessionActions everywhere />
      </Stack>
    </ManageShell>
  );
}
