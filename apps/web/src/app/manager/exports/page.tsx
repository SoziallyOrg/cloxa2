import { FileDown } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { ManagerExportPanel } from "@/components/manager-export-panel";
import { RoleShell } from "@/components/role-shell";
import { nlBE } from "@/i18n/nl-BE";
import { requireRole } from "@/lib/auth/session";
import { getManagerTimeExports } from "@/lib/time-exports/server";

export const metadata: Metadata = { title: nlBE.managerExports.title };

export default async function ManagerExportsPage() {
  await requireRole("manager", "/manager/exports");
  const history = await getManagerTimeExports();
  return (
    <RoleShell
      title={nlBE.managerExports.title}
      description={nlBE.managerExports.description}
      icon={FileDown}
      status={nlBE.manager.status}
    >
      <p className="mt-5">
        <Link
          className="text-primary underline underline-offset-4"
          href="/manager/exports-v2"
        >
          Export met pauzes (v2)
        </Link>{" "}
        — V1 blijft beschikbaar voor werkperiodes zonder pauzehistoriek.
      </p>
      <ManagerExportPanel history={history} />
    </RoleShell>
  );
}
