import { ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth-shell";
import { LogoutForm } from "@/components/logout-form";
import { ManagerMfaRecoveryForm } from "@/components/manager-mfa-forms";
import { nlBE } from "@/i18n/nl-BE";
import { getAuthorizedPathWithReturn } from "@/lib/auth/access";
import { getSafeManagerReturnPath } from "@/lib/auth/routes";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: nlBE.managerMfa.recoveryTitle };

export default async function ManagerMfaRecoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ volgende?: string }>;
}) {
  const returnTo = getSafeManagerReturnPath((await searchParams).volgende);
  const context = await getAuthContext();

  if (context.state !== "manager_mfa_recovery_required") {
    redirect(getAuthorizedPathWithReturn(context, returnTo));
  }

  const recovery = context.recovery;

  return (
    <AuthShell
      description={nlBE.managerMfa.recoveryDescription}
      icon={ShieldAlert}
      title={nlBE.managerMfa.recoveryTitle}
    >
      <p className="max-w-xl text-sm leading-6 text-muted">
        {recovery?.state === "expired"
          ? nlBE.managerMfa.recoveryExpiredHelp
          : recovery?.state === "fresh_login_required"
            ? nlBE.managerMfa.recoveryFreshLoginHelp
            : recovery?.state === "active" || recovery?.state === "awaiting_operator"
              ? nlBE.managerMfa.recoveryWindowHelp
              : nlBE.managerMfa.recoveryHelp}
      </p>
      {recovery?.state === "active" ? (
        <div className="mt-6">
          <ManagerMfaRecoveryForm caseId={recovery.caseId} />
        </div>
      ) : null}
      {recovery?.state === "awaiting_operator" ? (
        <div className="mt-6 grid max-w-md gap-3" role="status">
          <p className="text-sm leading-6 text-ink">
            {nlBE.managerMfa.recoveryAwaitingOperator}
          </p>
          <p className="text-sm leading-6 text-muted">
            {nlBE.managerMfa.recoveryCandidateLabel}
          </p>
          <code className="max-w-full rounded-lg bg-paper-strong px-3 py-2 text-sm break-all text-ink">
            {recovery.candidateId}
          </code>
        </div>
      ) : null}
      <div className="mt-8 border-t border-rule pt-6">
        <LogoutForm />
      </div>
    </AuthShell>
  );
}
