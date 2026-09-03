import { FilePenLine } from "lucide-react";
import type { Metadata } from "next";

import { CorrectionRequestPanel } from "@/components/correction-request-panel";
import { RoleShell } from "@/components/role-shell";
import { nlBE } from "@/i18n/nl-BE";
import { requireRole } from "@/lib/auth/session";
import { getEmployeeCorrectionRequests } from "@/lib/corrections/server";

export const metadata: Metadata = {
  title: nlBE.corrections.title,
};

export default async function EmployeeCorrectionsPage() {
  await requireRole("employee");
  const view = await getEmployeeCorrectionRequests();

  return (
    <RoleShell
      description={nlBE.corrections.description}
      icon={FilePenLine}
      status={nlBE.employee.status}
      title={nlBE.corrections.title}
    >
      <CorrectionRequestPanel view={view} />
    </RoleShell>
  );
}
