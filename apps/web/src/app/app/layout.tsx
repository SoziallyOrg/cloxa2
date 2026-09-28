import type { ReactNode } from "react";

import { AppShell } from "@/components/employee/AppShell";
import { RegisterShellWorker } from "@/components/offline/ShellWorker";
import { requireEmployeeArea } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

/** `/app/**`: an active membership with an employee row. */
export default async function EmployeeAppLayout({ children }: { children: ReactNode }) {
  const context = await requireEmployeeArea();
  const supabase = await createClient();
  const { data: employee, error } = await supabase
    .from("employees")
    .select("display_name")
    .eq("id", context.employeeId)
    .single();
  if (error) throw new Error(`employee_unavailable:${error.code}`);

  return (
    <AppShell employeeId={context.employeeId} displayName={employee.display_name}>
      <RegisterShellWorker />
      {children}
    </AppShell>
  );
}
