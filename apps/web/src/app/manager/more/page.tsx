import { Ellipsis } from "lucide-react";
import { RoleShell } from "@/components/role-shell";
import { ManagerMore } from "@/components/manager-more";
import { requireRole } from "@/lib/auth/session";
export const metadata = { title: "Meer" };
export default async function MorePage() {
  await requireRole("manager", "/manager/more");
  return (
    <RoleShell
      title="Meer"
      description="Exports en aanvullende opties voor je werkruimte."
      icon={Ellipsis}
      status="Manager"
    >
      <ManagerMore />
    </RoleShell>
  );
}
