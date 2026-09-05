import { KeyRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PasswordForm } from "@/components/auth-forms";
import { AuthShell } from "@/components/auth-shell";
import { ManagerMfaPasswordRecoveryVerifyForm } from "@/components/manager-mfa-forms";
import { Button } from "@/components/ui/button";
import { nlBE } from "@/i18n/nl-BE";
import { requireAuthFlow } from "@/lib/auth/flow-intent";
import { getAuthContext } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: nlBE.metadata.resetPasswordTitle };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ melding?: string }>;
}) {
  const { melding } = await searchParams;
  let ready = false;
  let managerMfaState: "verify" | "blocked" | null = null;

  if (melding !== "ongeldig") {
    try {
      const supabase = await createSupabaseServerClient();
      ready = await requireAuthFlow("recovery", supabase);
      if (ready) {
        const context = await getAuthContext(supabase);
        managerMfaState =
          context.state === "manager_mfa_verify"
            ? "verify"
            : context.state === "manager_mfa_recovery_required"
              ? "blocked"
              : null;
      }
    } catch {
      // An unavailable provider cannot authorize a password form.
    }
  }

  return (
    <AuthShell
      description={nlBE.resetPassword.description}
      icon={KeyRound}
      title={nlBE.resetPassword.title}
    >
      {ready && managerMfaState === "verify" ? (
        <ManagerMfaPasswordRecoveryVerifyForm />
      ) : ready && managerMfaState === "blocked" ? (
        <div className="grid justify-items-start gap-5">
          <p className="text-sm leading-6 text-danger" role="alert">
            {nlBE.managerMfa.passwordRecoveryBlocked}
          </p>
          <Button asChild variant="secondary">
            <Link href="/manager/security/recovery-required">
              {nlBE.managerMfa.recoveryTitle}
            </Link>
          </Button>
        </div>
      ) : ready ? (
        <PasswordForm purpose="recovery" />
      ) : (
        <div className="grid justify-items-start gap-5">
          <p className="text-sm leading-6 text-danger" role="alert">
            {nlBE.auth.recoveryUnavailable}
          </p>
          <Button asChild variant="secondary">
            <Link href="/forgot-password">{nlBE.auth.recoverySubmit}</Link>
          </Button>
        </div>
      )}
    </AuthShell>
  );
}
