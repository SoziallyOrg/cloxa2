import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { RoleShell } from "@/components/role-shell";
import { TeamPanel } from "@/components/team-panel";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/session";
import { getManagerTeam } from "@/lib/team/server";

export const metadata: Metadata = { title: "Team en pilotinstellingen" };

// Established docket system: settings first, roster second, invitations last.
// Inline editing and explicit access confirmation keep context at 320px.
export default async function ManagerTeamPage() {
  await requireRole("manager");
  const view = await getManagerTeam();
  return (
    <RoleShell
      icon={Users}
      title="Team en pilotinstellingen"
      status="Beheerder"
      description="Beheer medewerkergegevens, toegang en de namen van je organisatie en werkplek."
    >
      <Button asChild variant="quiet" className="mt-4">
        <Link href="/manager">Terug naar beheer</Link>
      </Button>
      {view ? (
        <TeamPanel view={view} />
      ) : (
        <p role="alert" className="mt-6 text-base leading-7">
          Teamoverzicht kan niet worden geladen. Vernieuw de pagina of meld je opnieuw
          aan.
        </p>
      )}
    </RoleShell>
  );
}
