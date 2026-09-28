import type { ReactNode } from "react";

import { requireManager } from "@/lib/auth/context";

/** aal2, MFA at most 12 hours old and activity in the last 30 minutes. */
export default async function SecuredManageLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireManager();
  return children;
}
