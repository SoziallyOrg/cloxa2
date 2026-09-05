import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth-shell";
import { LogoutForm } from "@/components/logout-form";
import { ManagerMfaSetupForm } from "@/components/manager-mfa-forms";
import { nlBE } from "@/i18n/nl-BE";
import { getAuthorizedPathWithReturn } from "@/lib/auth/access";
import { getSafeManagerReturnPath } from "@/lib/auth/routes";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: nlBE.managerMfa.setupTitle };

export default async function ManagerMfaSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ volgende?: string }>;
}) {
  const returnTo = getSafeManagerReturnPath((await searchParams).volgende);
  const context = await getAuthContext();

  if (context.state !== "manager_mfa_setup") {
    redirect(getAuthorizedPathWithReturn(context, returnTo));
  }

  return (
    <AuthShell
      description={nlBE.managerMfa.setupDescription}
      icon={ShieldCheck}
      title={nlBE.managerMfa.setupTitle}
    >
      <ManagerMfaSetupForm returnTo={returnTo} />
      <div className="mt-8 border-t border-rule pt-6">
        <LogoutForm />
      </div>
    </AuthShell>
  );
}
