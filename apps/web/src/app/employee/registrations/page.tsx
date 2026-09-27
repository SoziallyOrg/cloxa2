import { ListChecks } from "lucide-react";
import { CorrectionRequestPanel } from "@/components/correction-request-panel";
import { RoleShell } from "@/components/role-shell";
import { requireRole } from "@/lib/auth/session";
import { getEmployeeCorrectionRequests } from "@/lib/corrections/server";
import { getEmployeeProvenance } from "@/lib/corrections/provenance-server";
export const metadata = { title: "Registraties" };
export default async function RegistrationsPage() {
  await requireRole("employee");
  const view = await getEmployeeCorrectionRequests();
  const provenance = view ? await getEmployeeProvenance(view.entries) : null;
  return (
    <RoleShell
      title="Registraties"
      description="Bekijk je afgesloten werktijden en toegepaste correcties. Kies een registratie om een aanpassing aan te vragen."
      icon={ListChecks}
      status="Medewerker"
    >
      <CorrectionRequestPanel
        view={view}
        provenance={provenance}
        mode="registrations"
      />
    </RoleShell>
  );
}
