import { redirect } from "next/navigation";

import { t } from "@cloxa/i18n";

import { AuthShell } from "@/components/auth/AuthShell";
import { SessionActions } from "@/components/auth/SessionActions";
import { requireSignedIn, routingState } from "@/lib/auth/context";
import { destinationFor } from "@/lib/auth/routing";

export default async function NoAccessPage() {
  const context = await requireSignedIn();
  const destination = destinationFor(routingState(context));
  if (destination !== "/geen-toegang") redirect(destination);

  return (
    <AuthShell title={t("access.noAccessTitle")}>
      <p className="text-lg">{t("access.noAccessBody")}</p>
      <SessionActions />
    </AuthShell>
  );
}
