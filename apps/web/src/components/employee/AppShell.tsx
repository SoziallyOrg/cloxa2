import type { ReactNode } from "react";

import { t } from "@cloxa/i18n";

import { BottomNav, type BottomNavItem } from "../ui/BottomNav";
import { IconChat, IconClock, IconList } from "../ui/icons";
import type { EmployeeHomeNav } from "./EmployeeHome";

export interface AppShellProps {
  active: EmployeeHomeNav;
  children: ReactNode;
}

/** The shared frame for `/app/uren` and `/app/vragen`: content plus the bottom nav. */
export function AppShell({ active, children }: AppShellProps) {
  const navItems: BottomNavItem[] = [
    {
      key: "clock",
      label: t("bottomNav.clock"),
      href: "/app",
      icon: <IconClock />,
      current: active === "clock",
    },
    {
      key: "hours",
      label: t("bottomNav.hours"),
      href: "/app/uren",
      icon: <IconList />,
      current: active === "hours",
    },
    {
      key: "questions",
      label: t("bottomNav.questions"),
      href: "/app/vragen",
      icon: <IconChat />,
      current: active === "questions",
    },
  ];

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col">
      <main className="flex flex-1 flex-col gap-6 px-4 py-6 pb-28">{children}</main>
      <div className="fixed inset-x-0 bottom-0 mx-auto w-full max-w-xl">
        <BottomNav items={navItems} />
      </div>
    </div>
  );
}
