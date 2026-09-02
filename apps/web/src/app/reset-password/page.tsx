import { KeyRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PasswordForm } from "@/components/auth-forms";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { nlBE } from "@/i18n/nl-BE";
import { requireAuthFlow } from "@/lib/auth/flow-intent";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: nlBE.metadata.resetPasswordTitle };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ melding?: string }>;
}) {
  const { melding } = await searchParams;
  let ready = false;

  if (melding !== "ongeldig") {
    try {
      const supabase = await createSupabaseServerClient();
      ready = await requireAuthFlow("recovery", supabase);
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
      {ready ? (
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
