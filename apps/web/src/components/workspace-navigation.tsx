"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Clock3,
  ListChecks,
  Inbox,
  LayoutDashboard,
  Users,
  Ellipsis,
} from "lucide-react";
import {
  workspaceLinks,
  workspaceDestination,
  type WorkspaceRole,
} from "@/lib/workspace-routes";

export function WorkspaceNavigation({ role }: { role: WorkspaceRole }) {
  const pathname = usePathname();
  const icons =
    role === "employee"
      ? [Clock3, ListChecks, Inbox]
      : [LayoutDashboard, Inbox, Users, Ellipsis];
  return (
    <nav
      aria-label={role === "employee" ? "Medewerkernavigatie" : "Managernavigatie"}
      className="workspace-navigation"
    >
      {workspaceLinks[role].map(([href, label], index) => {
        const Icon = icons[index]!;
        return (
          <Link
            key={href}
            href={href}
            prefetch={false}
            aria-current={
              workspaceDestination(role, pathname) === href ? "page" : undefined
            }
            className="workspace-link"
          >
            <Icon aria-hidden="true" size={20} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function RequestNavigation({ role }: { role: WorkspaceRole }) {
  const path = usePathname();
  const requestPath =
    role === "employee" ? "/employee/requests" : "/manager/corrections";
  if (path !== requestPath && path !== `/${role}/break-corrections`) return null;
  return (
    <nav className="workspace-secondary" aria-label="Soort aanvraag">
      {(
        [
          [requestPath, "Werktijd"],
          [`/${role}/break-corrections`, "Pauzes"],
        ] as const
      ).map(([href, label]) => (
        <Link
          key={href}
          href={href}
          prefetch={false}
          className="workspace-link"
          aria-current={path === href ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
