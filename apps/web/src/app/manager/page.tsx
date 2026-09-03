import { ClipboardCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";

import { RoleShell } from "@/components/role-shell";
import { EmployeeInvitationForm } from "@/components/auth-forms";
import { nlBE } from "@/i18n/nl-BE";
import { requireRole } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: nlBE.manager.title,
};

export default async function ManagerPage() {
  await requireRole("manager");
  return (
    <RoleShell
      description={nlBE.manager.description}
      icon={ClipboardCheck}
      status={nlBE.manager.status}
      title={nlBE.manager.title}
    >
      <Button asChild className="mt-6 w-full sm:w-auto">
        <Link href="/manager/corrections">{nlBE.managerCorrections.title}</Link>
      </Button>
      <div className="mt-8 border-t border-rule pt-8">
        <h2 className="font-display text-3xl font-semibold tracking-[-0.025em] text-ink">
          {nlBE.invitation.title}
        </h2>
        <p className="mt-3 max-w-2xl text-base leading-7 text-muted">
          {nlBE.invitation.description}
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
          {nlBE.invitation.localOnly}
        </p>
        <EmployeeInvitationForm />
      </div>
    </RoleShell>
  );
}
