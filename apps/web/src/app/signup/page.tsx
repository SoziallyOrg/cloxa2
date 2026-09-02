import { Mail } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { nlBE } from "@/i18n/nl-BE";

export const metadata: Metadata = {
  title: nlBE.metadata.signupTitle,
};

export default function SignupPage() {
  return (
    <AuthShell
      description={nlBE.signup.description}
      icon={Mail}
      title={nlBE.signup.title}
    >
      <p className="text-sm leading-6 text-muted">{nlBE.signup.noInvitation}</p>
      <Button asChild className="mt-6" variant="secondary">
        <Link href="/login">{nlBE.signup.backToLogin}</Link>
      </Button>
    </AuthShell>
  );
}
