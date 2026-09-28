import type { ReactNode } from "react";

import { Logo } from "../brand/Logo";
import { AccountMenu } from "./AccountMenu";
import { EmployeeNav } from "./EmployeeNav";

export interface AppShellProps {
  employeeId: string;
  /** The employee's display name, e.g. "Jan Janssens". */
  displayName: string;
  children: ReactNode;
}

/** "Jan Janssens" → "Jan J."; a single name stays as it is. */
export function shortDisplayName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  const first = parts[0] ?? displayName;
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
}

/**
 * The frame of every `/app` page. Phones: the logotype and the name on top,
 * the tab bar at the bottom. Desktop: a quiet sidebar and one centred column.
 */
export function AppShell({ employeeId, displayName, children }: AppShellProps) {
  const account = {
    employeeId,
    shortName: shortDisplayName(displayName),
    fullName: displayName,
  };

  return (
    <div className="min-h-dvh md:flex">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-10 border-r border-line px-5 py-8 md:flex">
        <div className="px-3">
          <Logo />
        </div>
        <EmployeeNav variant="side" />
        <div className="mt-auto">
          <AccountMenu {...account} placement="sidebar" />
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between px-gutter pt-[env(safe-area-inset-top)] md:hidden">
          <Logo />
          <AccountMenu {...account} placement="header" />
        </header>
        <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-gutter pt-2 pb-[calc(var(--spacing-tab-bar)+env(safe-area-inset-bottom)+2rem)] md:px-gutter-desktop md:pt-16 md:pb-16">
          {children}
        </main>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 md:hidden">
        <EmployeeNav variant="tabs" />
      </div>
    </div>
  );
}
