import { UserRound } from "lucide-react";
import type { Metadata } from "next";

import { RoleShell } from "@/components/role-shell";
import { nlBE } from "@/i18n/nl-BE";
import { requireRole } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: nlBE.employee.title,
};

export default async function EmployeePage() {
  await requireRole("employee");
  return (
    <RoleShell
      description={nlBE.employee.description}
      icon={UserRound}
      status={nlBE.employee.status}
      title={nlBE.employee.title}
    />
  );
}
