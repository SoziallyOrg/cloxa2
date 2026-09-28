import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import { Logo } from "@/components/brand/Logo";
import { SidebarLayout } from "@/components/ui/SidebarLayout";

import { PreviewNav } from "./PreviewNav";

/**
 * The design review of every primitive, with fake data, inside the real app
 * frame (sidebar on desktop, tab bar on phones). 404 in production, unless a
 * local production build opts in with CLOXA_PREVIEW=1 (`pnpm screens`).
 */
export default function PreviewLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === "production" && process.env["CLOXA_PREVIEW"] !== "1") {
    notFound();
  }

  return (
    <SidebarLayout
      sidebar={
        <>
          <div className="px-3">
            <Logo />
          </div>
          <PreviewNav variant="side" />
        </>
      }
      tabBar={<PreviewNav variant="tabs" />}
    >
      {children}
    </SidebarLayout>
  );
}
