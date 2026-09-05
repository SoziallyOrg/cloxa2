import { FileDown } from "lucide-react";
import { RoleShell } from "@/components/role-shell";
import { ExportV2Panel } from "@/components/export-v2-panel";
import { requireRole } from "@/lib/auth/session";
import { getV2History } from "@/lib/time-exports-v2/server";
export const metadata = { title: "Export met pauzes (v2)" };
export default async function Page() {
  await requireRole("manager", "/manager/exports-v2");
  return (
    <RoleShell
      title="Export met pauzes (v2)"
      description="Leg afgesloten werkperiodes vast met bruto tijd, onbetaalde pauzes en netto gewerkte tijd. Latere correcties veranderen eerdere exports niet."
      icon={FileDown}
      status="Beheerder"
    >
      <ExportV2Panel history={await getV2History()} />
    </RoleShell>
  );
}
