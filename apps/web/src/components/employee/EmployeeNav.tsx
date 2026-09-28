"use client";

import { usePathname } from "next/navigation";
import { CalendarDays, Clock, MessageSquare } from "lucide-react";

import { t } from "@cloxa/i18n";

import { Logo } from "../brand/Logo";
import { SidebarLayout, SidebarNav } from "../ui/SidebarLayout";
import { TabBar, type NavItem } from "../ui/TabBar";
import { AccountButton } from "./Account";

function navItems(pathname: string, pendingQuestions: number): NavItem[] {
  return [
    {
      key: "clock",
      label: t("bottomNav.clock"),
      href: "/app",
      icon: Clock,
      current: pathname === "/app",
    },
    {
      key: "hours",
      label: t("bottomNav.hours"),
      href: "/app/uren",
      icon: CalendarDays,
      current: pathname.startsWith("/app/uren"),
    },
    {
      key: "questions",
      label: t("bottomNav.questions"),
      href: "/app/vragen",
      icon: MessageSquare,
      current: pathname.startsWith("/app/vragen"),
      count: pendingQuestions,
    },
  ];
}

export interface EmployeeFrameProps {
  /** Questions still waiting for a manager: the Vragen badge. */
  pendingQuestions: number;
  children: React.ReactNode;
}

/**
 * The `/app` frame: Klok, Uren and Vragen as a tab bar on phones and a
 * translucent sidebar (with the account at the bottom) on desktop. Klok is
 * a plain hero page; everything else sits on the grouped background.
 */
export function EmployeeFrame({ pendingQuestions, children }: EmployeeFrameProps) {
  const pathname = usePathname();
  const items = navItems(pathname, pendingQuestions);
  const label = t("bottomNav.label");

  return (
    <SidebarLayout
      tone={pathname === "/app" ? "plain" : "grouped"}
      sidebar={
        <>
          <div className="px-3 pt-1">
            <Logo />
          </div>
          <SidebarNav items={items} label={label} />
          <div className="mt-auto">
            <AccountButton placement="sidebar" />
          </div>
        </>
      }
      tabBar={<TabBar items={items} label={label} />}
    >
      {children}
    </SidebarLayout>
  );
}
