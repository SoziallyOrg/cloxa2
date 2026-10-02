"use client";

import { usePathname } from "next/navigation";
import { CalendarDays, Clock, MessageSquare, UserRound } from "lucide-react";

import { t } from "@cloxa/i18n";

import type { ClockBarData } from "@/lib/clock/bar";

import { ClockBar, ClockBarProvider, ClockBarSpacer } from "../clock/ClockBar";
import { PhoneTopBar, SidebarHead } from "../shell/FrameParts";
import { SidebarLayout, SidebarNav } from "../ui/SidebarLayout";
import { TabBar, type NavItem } from "../ui/TabBar";
import { AccountButton } from "./Account";
import { CanManageProvider } from "./roles";

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
    {
      key: "me",
      label: t("bottomNav.me"),
      href: "/app/instellingen",
      icon: UserRound,
      current: pathname.startsWith("/app/instellingen"),
    },
  ];
}

export interface EmployeeFrameProps {
  /** Questions still waiting for a manager: the Vragen badge. */
  pendingQuestions: number;
  /** The person also has a manager, admin or owner role: the role switch shows. */
  canManage: boolean;
  /** Set while they are clocked in: the clock bar (off the Klok screen). */
  clockBar: ClockBarData | null;
  children: React.ReactNode;
}

/**
 * The `/app` frame: Klok, Uren, Vragen and Ik as a tab bar on phones and a
 * white sidebar (with the account at the bottom) on desktop. The clock bar
 * shows whenever someone is clocked in and not on Klok.
 */
export function EmployeeFrame({
  pendingQuestions,
  canManage,
  clockBar,
  children,
}: EmployeeFrameProps) {
  const pathname = usePathname();
  const items = navItems(pathname, pendingQuestions);
  const label = t("bottomNav.label");
  const roles = { current: "app", hasEmployee: true, canManage } as const;
  // Klok draws its own top row inside the status block; Uren has a wide table.
  const onKlok = pathname === "/app";
  const wide = onKlok || pathname.startsWith("/app/uren");

  return (
    <ClockBarProvider data={clockBar}>
      <CanManageProvider canManage={canManage}>
        <SidebarLayout
          wide={wide}
          {...(onKlok ? {} : { topBar: <PhoneTopBar {...roles} /> })}
          contentEnd={<ClockBarSpacer placement="content" />}
          sidebar={
            <>
              <SidebarHead {...roles} />
              <SidebarNav items={items} label={label} />
              <div className="mt-auto flex flex-col gap-3">
                <ClockBarSpacer placement="sidebar" />
                <AccountButton placement="sidebar" />
              </div>
            </>
          }
          tabBar={<TabBar items={items} label={label} />}
        >
          {children}
        </SidebarLayout>
        <ClockBar data={clockBar} />
      </CanManageProvider>
    </ClockBarProvider>
  );
}
