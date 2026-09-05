import { ClipboardCheck } from "lucide-react";
import type { Metadata } from "next";
import { RoleShell } from "@/components/role-shell";
import { ManagerCorrectionPanel } from "@/components/manager-correction-panel";
import { nlBE } from "@/i18n/nl-BE";
import { requireRole } from "@/lib/auth/session";
import { getManagerCorrectionRequests } from "@/lib/manager-corrections/server";

export const metadata: Metadata = { title: nlBE.managerCorrections.title };

export default async function ManagerCorrectionsPage() {
  await requireRole("manager", "/manager/corrections");
  const view = await getManagerCorrectionRequests();
  return (
    <RoleShell
      title={nlBE.managerCorrections.title}
      description={nlBE.managerCorrections.description}
      icon={ClipboardCheck}
      status={nlBE.manager.status}
    >
      <ManagerCorrectionPanel view={view} />
    </RoleShell>
  );
}
