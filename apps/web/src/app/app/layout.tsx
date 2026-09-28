import type { ReactNode } from "react";

import { RegisterShellWorker } from "@/components/offline/ShellWorker";
import { requireEmployeeArea } from "@/lib/auth/context";

/** `/app/**`: an active membership with an employee row. */
export default async function EmployeeAppLayout({ children }: { children: ReactNode }) {
  await requireEmployeeArea();
  return (
    <>
      <RegisterShellWorker />
      {children}
    </>
  );
}
