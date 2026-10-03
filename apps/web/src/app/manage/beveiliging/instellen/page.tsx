import { redirect } from "next/navigation";

import { t } from "@cloxa/i18n";

import { AuthShell } from "@/components/auth/AuthShell";
import { MfaEnrolment } from "@/components/auth/MfaEnrolment";
import { SessionActions } from "@/components/auth/SessionActions";
import { hasVerifiedTotp, requirePrivilegedRole } from "@/lib/auth/context";

export default async function MfaSetupPage() {
  await requirePrivilegedRole();
  // One factor per manager for now; replacing it needs recovery (TODO).
  if (await hasVerifiedTotp()) redirect("/manage/beveiliging/controle");

  return (
    <AuthShell
      title={t("mfa.setupTitle")}
      intro={<p className="text-body text-ink-2">{t("mfa.setupIntro")}</p>}
    >
      <MfaEnrolment />
      <SessionActions />
    </AuthShell>
  );
}
