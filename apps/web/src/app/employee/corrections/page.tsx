import { FilePenLine } from "lucide-react";
import type { Metadata } from "next";

import { getEmployeeProvenance } from "@/lib/corrections/provenance-server";
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
  const provenance = view ? await getEmployeeProvenance(view.entries) : null;

  return (
    <RoleShell
      description={nlBE.corrections.description}
      icon={FilePenLine}
      status={nlBE.employee.status}
      title={nlBE.corrections.title}
    >
      <CorrectionRequestPanel view={view} provenance={provenance} />
    </RoleShell>
  );
}
