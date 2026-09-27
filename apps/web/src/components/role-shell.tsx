import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { LogoutForm } from "@/components/logout-form";

import { getAuthContext } from "@/lib/auth/session";
import { WorkspaceShell } from "./workspace-shell";
import { EmployeeClockScope } from "./employee-clock-provider";

export async function RoleShell({
  description,
  title,
  children,
}: {
  children?: ReactNode;
  description: string;
  icon: LucideIcon;
  status: string;
  title: string;
}) {
  const auth = await getAuthContext();
  if (auth.state !== "authorized") return null;
  const shell = (
    <WorkspaceShell
      role={auth.role}
      scope={`${auth.userId}:${auth.organizationId}`}
      title={title}
      description={description}
      account={<LogoutForm />}
    >
      {children}
    </WorkspaceShell>
  );
  return auth.role === "employee" ? (
    <EmployeeClockScope scope={`${auth.userId}:${auth.organizationId}`}>
      {shell}
    </EmployeeClockScope>
  ) : (
    shell
  );
}
