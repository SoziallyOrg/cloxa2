import { KeyRound, LockKeyhole } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { nlBE } from "@/i18n/nl-BE";

export const metadata: Metadata = {
  title: nlBE.metadata.loginTitle,
};

export default function LoginPage() {
  return (
    <AuthShell
      description={nlBE.login.description}
      icon={LockKeyhole}
      title={nlBE.login.title}
    >
      <div className="flex min-h-12 items-center gap-3 rounded-xl bg-paper-strong px-4 text-sm font-semibold text-muted">
        <KeyRound aria-hidden="true" className="size-5 text-primary" />
        {nlBE.login.status}
      </div>
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
