import { FilePenLine } from "lucide-react";
import { RoleShell } from "@/components/role-shell";
import { BreakCorrectionPanel } from "@/components/break-correction-panel";
import { breakCopy } from "@/lib/break-corrections/copy";
import { getBreakCorrections } from "@/lib/break-corrections/server";
import { requireRole } from "@/lib/auth/session";
export const metadata = { title: breakCopy.title };
export default async function Page() {
  await requireRole("employee");
  return (
    <RoleShell
      title={breakCopy.title}
      description={breakCopy.description}
      icon={FilePenLine}
      status="Medewerker"
    >
      <BreakCorrectionPanel view={await getBreakCorrections()} manager={false} />
    </RoleShell>
  );
}
