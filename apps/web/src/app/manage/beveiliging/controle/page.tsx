import { redirect } from "next/navigation";

import { t } from "@cloxa/i18n";

import { AuthShell } from "@/components/auth/AuthShell";
import { CodeForm } from "@/components/auth/CodeForm";
import { SessionActions } from "@/components/auth/SessionActions";
import { verifyTotp } from "@/lib/auth/actions/mfa";
import { hasVerifiedTotp, requirePrivilegedRole } from "@/lib/auth/context";

export default async function MfaVerifyPage() {
  await requirePrivilegedRole();
  if (!(await hasVerifiedTotp())) redirect("/manage/beveiliging/instellen");

  return (
    <AuthShell title={t("mfa.verifyTitle")}>
      <p className="text-lg">{t("mfa.verifyIntro")}</p>
      <CodeForm
        id="mfa-verify-code"
        label={t("mfa.codeLabel")}
        hint={t("mfa.codeHint")}
        submitLabel={t("mfa.verifySubmit")}
        action={verifyTotp}
      />
      <SessionActions />
    </AuthShell>
  );
}
