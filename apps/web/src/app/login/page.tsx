import { LockKeyhole } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "@/components/auth-forms";
import { Button } from "@/components/ui/button";
import { nlBE } from "@/i18n/nl-BE";
import { getSafePostAuthPath } from "@/lib/auth/routes";

export const metadata: Metadata = {
  title: nlBE.metadata.loginTitle,
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ volgende?: string; melding?: string }>;
}) {
  const params = await searchParams;
  return (
    <AuthShell
      description={nlBE.login.description}
      icon={LockKeyhole}
      title={nlBE.login.title}
    >
      <LoginForm
        callbackFailed={params.melding === nlBE.authCallback.failureCode}
        next={getSafePostAuthPath(params.volgende)}
      />
      <div className="mt-6 flex flex-col items-start gap-3 text-sm">
        <Link className="font-semibold text-primary underline" href="/forgot-password">
          {nlBE.login.forgotPassword}
        </Link>
        <p className="text-muted">{nlBE.login.invitationHelp}</p>
        <Button asChild variant="secondary">
          <Link href="/signup">{nlBE.login.invitationLink}</Link>
        </Button>
      </div>
    </AuthShell>
  );
}
