import { MailCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PasswordForm } from "@/components/auth-forms";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { nlBE } from "@/i18n/nl-BE";
import { requireAuthFlow } from "@/lib/auth/flow-intent";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: nlBE.metadata.acceptInvitationTitle };

export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ melding?: string }>;
}) {
  const { melding } = await searchParams;
  let ready = false;

  if (melding !== "ongeldig") {
    try {
      const supabase = await createSupabaseServerClient();
      if (await requireAuthFlow("invite", supabase)) {
        const invitation = await supabase.rpc("get_employee_invitation_state");
        ready = !invitation.error && invitation.data === "ready";
      }
    } catch {
      // An unavailable provider cannot authorize a password form.
    }
  }

  return (
    <AuthShell
      description={nlBE.acceptInvitation.description}
      icon={MailCheck}
      title={nlBE.acceptInvitation.title}
    >
      {ready ? (
        <PasswordForm purpose="invite" />
      ) : (
        <div className="grid justify-items-start gap-5">
          <p className="text-sm leading-6 text-danger" role="alert">
            {nlBE.auth.invitationUnavailable}
          </p>
          <Button asChild variant="secondary">
            <Link href="/login">{nlBE.common.openLogin}</Link>
          </Button>
        </div>
      )}
    </AuthShell>
  );
}
