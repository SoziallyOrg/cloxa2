import type { ReactNode } from "react";

import { AccountProvider } from "@/components/employee/Account";
import { shortDisplayName } from "@/components/employee/account-name";
import { EmployeeFrame } from "@/components/employee/EmployeeNav";
import { RegisterShellWorker } from "@/components/offline/ShellWorker";
import { requireEmployeeArea } from "@/lib/auth/context";
import { isPrivileged } from "@/lib/auth/routing";
import { loadClockBar } from "@/lib/clock/bar";
import { createClient } from "@/lib/supabase/server";

/** `/app/**`: an active membership with an employee row. */
export default async function EmployeeAppLayout({ children }: { children: ReactNode }) {
  const context = await requireEmployeeArea();
  const supabase = await createClient();
  const [employeeResult, pendingResult, clockBar] = await Promise.all([
    supabase
      .from("employees")
      .select("display_name")
      .eq("id", context.employeeId)
      .single(),
    supabase
      .from("correction_requests")
      .select("id", { count: "exact", head: true })
      .eq("employee_id", context.employeeId)
      .eq("status", "pending"),
    // Shown off the Klok screen while clocked in; a failed read just hides it.
    loadClockBar(context.employeeId),
  ]);
  const { data: employee, error } = employeeResult;
  if (error) throw new Error(`employee_unavailable:${error.code}`);
  // The badge is a nicety: a failed count shows none rather than an error page.
  const pendingQuestions = pendingResult.error ? 0 : (pendingResult.count ?? 0);

  return (
    <AccountProvider
      account={{
        employeeId: context.employeeId,
        shortName: shortDisplayName(employee.display_name),
        fullName: employee.display_name,
      }}
    >
      <EmployeeFrame
        pendingQuestions={pendingQuestions}
        canManage={isPrivileged(context.membership.role)}
        clockBar={clockBar}
      >
        <RegisterShellWorker />
        {children}
      </EmployeeFrame>
    </AccountProvider>
  );
}
