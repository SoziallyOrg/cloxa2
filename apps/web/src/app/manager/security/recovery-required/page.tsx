import { ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth-shell";
import { LogoutForm } from "@/components/logout-form";
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

  return (
    <AuthShell
      description={nlBE.managerMfa.recoveryDescription}
      icon={ShieldAlert}
      title={nlBE.managerMfa.recoveryTitle}
    >
      <p className="max-w-xl text-sm leading-6 text-muted">
        {nlBE.managerMfa.recoveryHelp}
      </p>
      <div className="mt-8 border-t border-rule pt-6">
        <LogoutForm />
      </div>
    </AuthShell>
  );
}
