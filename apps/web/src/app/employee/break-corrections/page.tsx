import { getEmployeeProvenance } from "@/lib/corrections/provenance-server";
import { FilePenLine } from "lucide-react";
import { RoleShell } from "@/components/role-shell";
import { BreakCorrectionPanel } from "@/components/break-correction-panel";
import { breakCopy } from "@/lib/break-corrections/copy";
import { getBreakCorrections } from "@/lib/break-corrections/server";
import { requireRole } from "@/lib/auth/session";
export const metadata = { title: breakCopy.title };
export default async function Page() {
  await requireRole("employee");
  const view = await getBreakCorrections();
  const provenance = view
    ? await getEmployeeProvenance(
        view.entries.map((e) => ({
          id: e.id,
          startedAt: e.started_at,
          endedAt: e.ended_at,
        })),
      )
    : null;
  return (
    <RoleShell
      title={breakCopy.title}
      description={breakCopy.description}
      icon={FilePenLine}
      status="Medewerker"
    >
      <BreakCorrectionPanel view={view} manager={false} provenance={provenance} />
    </RoleShell>
  );
}
