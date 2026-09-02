import { KeyRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth-shell";
import { ForgotPasswordForm } from "@/components/auth-forms";
import { Button } from "@/components/ui/button";
import { nlBE } from "@/i18n/nl-BE";

export const metadata: Metadata = {
  title: nlBE.metadata.forgotPasswordTitle,
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      description={nlBE.forgotPassword.description}
      icon={KeyRound}
      title={nlBE.forgotPassword.title}
    >
      <ForgotPasswordForm />
      <p className="mt-6 max-w-xl text-sm leading-6 text-muted">
        {nlBE.forgotPassword.privacy}
      </p>
      <Button asChild className="mt-6" variant="secondary">
        <Link href="/login">{nlBE.forgotPassword.backToLogin}</Link>
      </Button>
    </AuthShell>
  );
}
