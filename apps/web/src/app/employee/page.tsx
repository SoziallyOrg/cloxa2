import { FilePenLine, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { RoleShell } from "@/components/role-shell";
import { TimeClockPanel } from "@/components/time-clock-panel";
import { Button } from "@/components/ui/button";
import { nlBE } from "@/i18n/nl-BE";
import { requireRole } from "@/lib/auth/session";
import { getEmployeeTimeClock } from "@/lib/time-clock/server";

export const metadata: Metadata = {
  title: nlBE.employee.title,
};

export default async function EmployeePage() {
  await requireRole("employee");
  const clock = await getEmployeeTimeClock();

  return (
    <RoleShell
      description={nlBE.employee.description}
      icon={UserRound}
      status={nlBE.employee.status}
      title={nlBE.employee.title}
    >
      <div className="mt-7 flex flex-wrap justify-start gap-3">
        <Button asChild variant="secondary">
          <Link href="/employee/break-corrections">Pauzes corrigeren</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/employee/corrections">
            <FilePenLine aria-hidden="true" />
            {nlBE.corrections.openCorrections}
          </Link>
        </Button>
      </div>
      <TimeClockPanel clock={clock} />
    </RoleShell>
  );
}
