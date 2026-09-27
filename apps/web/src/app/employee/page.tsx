import { UserRound } from "lucide-react";
import type { Metadata } from "next";

import { getEmployeeProvenance } from "@/lib/corrections/provenance-server";
import { RoleShell } from "@/components/role-shell";
import { TimeClockPanel } from "@/components/time-clock-panel";

import { nlBE } from "@/i18n/nl-BE";
import { requireRole } from "@/lib/auth/session";
import { getEmployeeTimeClock } from "@/lib/time-clock/server";

export const metadata: Metadata = {
  title: nlBE.employee.title,
};

export default async function EmployeePage() {
  await requireRole("employee");
  const clock = await getEmployeeTimeClock();
  const provenance = clock ? await getEmployeeProvenance(clock.entries) : null;

  return (
    <RoleShell
      description={nlBE.employee.description}
      icon={UserRound}
      status={nlBE.employee.status}
      title={nlBE.employee.title}
    >
      <TimeClockPanel clock={clock} provenance={provenance} />
    </RoleShell>
  );
}
