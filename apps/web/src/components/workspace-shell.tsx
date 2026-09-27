"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { UserRound } from "lucide-react";
import { BrandMark } from "./brand-mark";
import { RequestNavigation, WorkspaceNavigation } from "./workspace-navigation";
import { WorkIndicator } from "./clock-controls";
import type { WorkspaceRole } from "@/lib/workspace-routes";

// Shared with the service-free preview; auth/data stay in RoleShell and protected pages.
export function WorkspaceShell({
  role,
  scope,
  title,
  description,
  account,
  children,
}: {
  role: WorkspaceRole;
  scope: string;
  title: string;
  description: string;
  account: ReactNode;
  children?: ReactNode;
}) {
  const path = usePathname();
  const root = useRef<HTMLDivElement>(null);
  const accountMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (accountMenu.current) accountMenu.current.open = false;
  }, [path, scope]);
  useEffect(() => {
    const element = root.current!;
    const header = element.querySelector(".workspace-header")!;
    const nav = element.querySelector(".workspace-navigation")!;
    const update = () => {
      const viewport = window.visualViewport;
      const editing = document.activeElement?.matches("input, textarea, select");
      // During keyboard occlusion, navigation moves into flow, never disappears.
      // Pinch zoom must not trigger this mode.
      element.dataset.keyboard = String(
        Boolean(
          editing &&
          viewport &&
          viewport.scale === 1 &&
          window.innerHeight - viewport.height > 120,
        ),
      );
      const headerHeight = header.getBoundingClientRect().height;
      const bottomHeight =
        getComputedStyle(nav).position === "fixed"
          ? nav.getBoundingClientRect().height
          : 0;
      element.style.setProperty("--workspace-header-height", `${headerHeight}px`);
      element.style.setProperty("--workspace-bottom-height", `${bottomHeight}px`);
      document.documentElement.style.setProperty(
        "--workspace-scroll-top",
        `${headerHeight + 16}px`,
      );
      document.documentElement.style.setProperty(
        "--workspace-scroll-bottom",
        `${bottomHeight + 16}px`,
      );
      element.style.setProperty(
        "--workspace-viewport-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(header);
    observer.observe(nav);
    window.visualViewport?.addEventListener("resize", update);
    window.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape" && accountMenu.current?.open) {
        accountMenu.current.open = false;
        accountMenu.current.querySelector("summary")?.focus();
      }
    };
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        accountMenu.current &&
        !accountMenu.current.contains(event.target)
      )
        accountMenu.current.open = false;
    };
    document.addEventListener("keydown", dismiss);
    document.addEventListener("pointerdown", outside);
    update();
    return () => {
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      document.removeEventListener("keydown", dismiss);
      document.removeEventListener("pointerdown", outside);
      document.documentElement.style.removeProperty("--workspace-scroll-top");
      document.documentElement.style.removeProperty("--workspace-scroll-bottom");
    };
  }, []);
  return (
    <div className="workspace-shell" ref={root}>
      <a className="workspace-skip" href="#main-content">
        Naar inhoud
      </a>
      <header className="workspace-header">
        <div className="workspace-brand" aria-label="Cloxa">
          <BrandMark />
        </div>
        <div className="workspace-heading">
          <h1>{title}</h1>
          {role === "employee" && <WorkIndicator />}
          <details className="workspace-account" ref={accountMenu}>
            <summary>
              <UserRound aria-hidden="true" size={20} />
              <span>Account</span>
            </summary>
            <div className="workspace-account-panel">
              <p className="mb-3 font-semibold">
                {role === "employee" ? "Medewerker" : "Manager"}
              </p>
              {account}
            </div>
          </details>
        </div>
      </header>
      <WorkspaceNavigation role={role} />
      <main id="main-content" tabIndex={-1} className="workspace-content">
        <RequestNavigation role={role} />
        <section className="workspace-surface">
          <p className="max-w-2xl text-base leading-7 text-muted">{description}</p>
          {children}
        </section>
      </main>
    </div>
  );
}
