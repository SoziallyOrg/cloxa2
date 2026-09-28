import type { ReactNode } from "react";

import { requirePrivilegedRole } from "@/lib/auth/context";

/**
 * `/manage/**`: owners, admins and managers only. MFA freshness is checked
 * one level down, in `(beveiligd)`, so the MFA pages themselves stay reachable.
 */
export default async function ManageLayout({ children }: { children: ReactNode }) {
  await requirePrivilegedRole();
  return children;
}
