"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ChartNoAxesGantt, Ellipsis, FileDown, Inbox, Users } from "lucide-react";

import { t } from "@cloxa/i18n";

import type { ClockBarData } from "@/lib/clock/bar";

import { ClockBar, ClockBarProvider, ClockBarSpacer } from "../clock/ClockBar";
import { PhoneTopBar, SidebarHead } from "../shell/FrameParts";
import { SidebarLayout, SidebarNav } from "../ui/SidebarLayout";
import { TabBar, type NavItem } from "../ui/TabBar";
import {
  ManageAccountButton,
  ManageAccountProvider,
  type ManageAccount,
} from "./ManageAccount";

const EXPORTS = "/manage/meer/exports";

function isTeam(pathname: string): boolean {
  return (
    pathname.startsWith("/manage/team") || pathname.startsWith("/manage/medewerker")
  );
}

/**
 * Desktop has room for Exports as its own item; phones keep four tabs and
 * reach Exports through Meer, so Meer stays current there.
 */
function navItems(
  pathname: string,
  pendingRequests: number,
  desktop: boolean,
): NavItem[] {
  const onExports = pathname.startsWith(EXPORTS);
  const items: NavItem[] = [
    {
      key: "today",
      label: t("manageNav.today"),
      href: "/manage",
      icon: ChartNoAxesGantt,
      current: pathname === "/manage",
    },
    {
      key: "requests",
      label: t("manageNav.questions"),
      href: "/manage/vragen",
      icon: Inbox,
      current: pathname.startsWith("/manage/vragen"),
      count: pendingRequests,
    },
    {
      key: "team",
      label: t("manageNav.team"),
      href: "/manage/team",
      icon: Users,
      current: isTeam(pathname),
    },
  ];
  if (desktop) {
    items.push({
      key: "exports",
      label: t("manageNav.exports"),
      href: EXPORTS,
      icon: FileDown,
      current: onExports,
    });
  }
  items.push({
    key: "more",
    label: t("manageNav.more"),
    href: "/manage/meer",
    icon: Ellipsis,
    current: pathname.startsWith("/manage/meer") && (!desktop || !onExports),
  });
  return items;
}

export interface ManageFrameProps {
  account: ManageAccount;
  /** Correction requests waiting for a decision: the Aanvragen count. */
  pendingRequests: number;
  /** Set while the manager (who also has an employee record) is clocked in. */
  clockBar: ClockBarData | null;
  children: ReactNode;
}

/**
 * The `/manage` frame, the same shell as the employee app: a white sidebar
 * with the account at the bottom on desktop (icons only on tablets), a tab
 * bar on phones. Vandaag uses the full width; everything else keeps the
 * readable column.
 */
export function ManageFrame({
  account,
  pendingRequests,
  clockBar,
  children,
}: ManageFrameProps) {
  const pathname = usePathname();
  const label = t("manageNav.sidebarLabel");
  // Managers are always allowed to manage here; the switch needs a clock too.
  const roles = {
    current: "manage",
    hasEmployee: account.canClock,
    canManage: true,
  } as const;

  return (
    <ManageAccountProvider account={account}>
      <ClockBarProvider data={clockBar}>
        <SidebarLayout
          wide={pathname === "/manage"}
          topBar={<PhoneTopBar {...roles} />}
          contentEnd={<ClockBarSpacer placement="content" />}
          sidebar={
            <>
              <SidebarHead {...roles} />
              <SidebarNav
                items={navItems(pathname, pendingRequests, true)}
                label={label}
              />
              <div className="mt-auto flex flex-col gap-3">
                <ClockBarSpacer placement="sidebar" />
                <ManageAccountButton account={account} />
              </div>
            </>
          }
          tabBar={
            <TabBar items={navItems(pathname, pendingRequests, false)} label={label} />
          }
        >
          {children}
        </SidebarLayout>
        <ClockBar data={clockBar} />
      </ClockBarProvider>
    </ManageAccountProvider>
  );
}
