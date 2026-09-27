import { Inbox } from "lucide-react";
import { CorrectionRequestPanel } from "@/components/correction-request-panel";
import { RoleShell } from "@/components/role-shell";
import { requireRole } from "@/lib/auth/session";
import { getEmployeeCorrectionRequests } from "@/lib/corrections/server";
export const metadata = { title: "Aanvragen" };
export default async function RequestsPage() {
  await requireRole("employee");
  const view = await getEmployeeCorrectionRequests();
  return (
    <RoleShell
      title="Aanvragen"
      description="Volg je tijdaanvragen en de beslissing van je manager. Pauzeaanvragen staan onder Pauzes."
      icon={Inbox}
      status="Medewerker"
    >
      <CorrectionRequestPanel view={view} mode="requests" />
    </RoleShell>
  );
}
