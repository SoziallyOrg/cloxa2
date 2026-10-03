"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import {
  ChartNoAxesGantt,
  Ellipsis,
  FileDown,
  Inbox,
  Tablet,
  Users,
} from "lucide-react";

import { t } from "@cloxa/i18n";

import type { ClockBarData } from "@/lib/clock/bar";
import { isWideManagePage } from "@/lib/manage/layout";

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
const KIOSKS = "/manage/meer/kiosks";

function isTeam(pathname: string): boolean {
  return (
    pathname.startsWith("/manage/team") || pathname.startsWith("/manage/medewerker")
  );
}

/**
 * Desktop has room for Exports (and Kiosks, for owners and admins) as their
 * own items; phones keep four tabs and reach them through Meer, so Meer stays
 * current there.
 */
function navItems(
  pathname: string,
  pendingRequests: number,
  desktop: boolean,
  canAdmin: boolean,
): NavItem[] {
  const onExports = pathname.startsWith(EXPORTS);
  const onKiosks = canAdmin && pathname.startsWith(KIOSKS);
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
  if (desktop && canAdmin) {
    items.push({
      key: "kiosks",
      label: t("manageKiosks.heading"),
      href: KIOSKS,
      icon: Tablet,
      current: onKiosks,
    });
  }
  items.push({
    key: "more",
    label: t("manageNav.more"),
    href: "/manage/meer",
    icon: Ellipsis,
    current:
      pathname.startsWith("/manage/meer") && (!desktop || !(onExports || onKiosks)),
  });
  return items;
}

export interface ManageFrameProps {
  account: ManageAccount;
  /** Correction requests waiting for a decision: the Aanvragen count. */
  pendingRequests: number;
  /** Owner or admin: the sidebar also lists Kiosks. */
  canAdmin?: boolean;
  /** Set while the manager (who also has an employee record) is clocked in. */
  clockBar: ClockBarData | null;
  children: ReactNode;
}

/**
 * The `/manage` frame, the same shell as the employee app: a white sidebar
 * with the account at the bottom on desktop (icons only on tablets), a tab
 * bar on phones. Pages built for width (timeline, tables) use the full main
 * column; forms keep the readable one (`isWideManagePage`).
 */
export function ManageFrame({
  account,
  pendingRequests,
  clockBar,
  canAdmin = false,
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
          wide={isWideManagePage(pathname)}
          topBar={<PhoneTopBar {...roles} />}
          contentEnd={<ClockBarSpacer placement="content" />}
          sidebar={
            <>
              <SidebarHead {...roles} />
              <SidebarNav
                items={navItems(pathname, pendingRequests, true, canAdmin)}
                label={label}
              />
              <div className="mt-auto flex flex-col gap-3">
                <ClockBarSpacer placement="sidebar" />
                <ManageAccountButton account={account} />
              </div>
            </>
          }
          tabBar={
            <TabBar
              items={navItems(pathname, pendingRequests, false, canAdmin)}
              label={label}
            />
          }
        >
          {children}
        </SidebarLayout>
        <ClockBar data={clockBar} />
      </ClockBarProvider>
    </ManageAccountProvider>
  );
}
