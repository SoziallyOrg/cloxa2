import { ClipboardCheck } from "lucide-react";
import { RoleShell } from "@/components/role-shell";
import { BreakCorrectionPanel } from "@/components/break-correction-panel";
import { breakCopy } from "@/lib/break-corrections/copy";
import { getBreakCorrections } from "@/lib/break-corrections/server";
import { requireRole } from "@/lib/auth/session";
export const metadata = { title: breakCopy.reviewTitle };
export default async function Page() {
  await requireRole("manager", "/manager/break-corrections");
  return (
    <RoleShell
      title={breakCopy.reviewTitle}
      description={breakCopy.reviewDescription}
      icon={ClipboardCheck}
      status="Beheerder"
    >
      <BreakCorrectionPanel view={await getBreakCorrections()} manager />
    </RoleShell>
  );
}
