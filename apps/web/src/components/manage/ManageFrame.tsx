"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ChartNoAxesGantt, Ellipsis, FileDown, Inbox, Users } from "lucide-react";

import { t } from "@cloxa/i18n";

import { Logo } from "../brand/Logo";
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
  children: ReactNode;
}

/**
 * The `/manage` frame, the same as the employee app's: a translucent
 * sidebar with the account at the bottom on desktop, a tab bar on phones.
 * Vandaag uses the full width for its timeline; everything else keeps the
 * readable column.
 */
export function ManageFrame({ account, pendingRequests, children }: ManageFrameProps) {
  const pathname = usePathname();
  const label = t("manageNav.sidebarLabel");

  return (
    <ManageAccountProvider account={account}>
      <SidebarLayout
        wide={pathname === "/manage"}
        sidebar={
          <>
            <div className="px-3 pt-1">
              <Logo />
            </div>
            <SidebarNav
              items={navItems(pathname, pendingRequests, true)}
              label={label}
            />
            <div className="mt-auto">
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
    </ManageAccountProvider>
  );
}
