import type { ReactNode } from "react";
import { EmployeeClockProvider } from "@/components/employee-clock-provider";
import { requireRole } from "@/lib/auth/session";

export default async function EmployeeLayout({ children }: { children: ReactNode }) {
  const auth = await requireRole("employee");
  return (
    <EmployeeClockProvider scope={`${auth.userId}:${auth.organizationId}`}>
      {children}
    </EmployeeClockProvider>
  );
}
