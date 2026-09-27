"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { usesWorkspaceShell } from "@/lib/workspace-routes";
export function SiteChrome({
  children,
  header,
  footer,
}: {
  children: ReactNode;
  header: ReactNode;
  footer: ReactNode;
}) {
  const workspace = usesWorkspaceShell(usePathname());
  return (
    <>
      {!workspace && header}
      {children}
      {!workspace && footer}
    </>
  );
}
