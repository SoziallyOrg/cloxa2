import { ClipboardCheck, FileDown } from "lucide-react";
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
  await requireRole("manager", "/manager");
  return (
    <RoleShell
      description={nlBE.manager.description}
      icon={ClipboardCheck}
      status={nlBE.manager.status}
      title={nlBE.manager.title}
    >
      <div className="mt-6 flex flex-col flex-wrap gap-3 sm:flex-row">
        <Button asChild variant="secondary" className="h-auto py-3 whitespace-normal">
          <Link href="/manager/team">Team en pilotinstellingen</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/manager/break-corrections">Pauzeaanvragen beoordelen</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/manager/exports-v2">Export met pauzes (v2)</Link>
        </Button>
        <Button asChild className="w-full sm:w-auto">
          <Link href="/manager/corrections">{nlBE.managerCorrections.title}</Link>
        </Button>
        <Button asChild variant="secondary" className="w-full sm:w-auto">
          <Link href="/manager/exports">
            <FileDown aria-hidden="true" />
            {nlBE.managerExports.open}
          </Link>
        </Button>
      </div>
      <div id="medewerker-uitnodigen" className="mt-8 border-t border-rule pt-8">
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
