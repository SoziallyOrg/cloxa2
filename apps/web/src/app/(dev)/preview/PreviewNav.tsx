"use client";

import {
  CalendarDays,
  Clock,
  LayoutGrid,
  MessageCircleQuestionMark,
} from "lucide-react";
import { usePathname } from "next/navigation";

import { t } from "@cloxa/i18n";

import { SidebarNav } from "@/components/ui/SidebarLayout";
import { TabBar, type NavItem } from "@/components/ui/TabBar";

/** Fake destinations: all but the first lead to the pushed demo page. */
function items(pathname: string): NavItem[] {
  const onParts = pathname === "/preview";
  return [
    {
      key: "parts",
      label: t("preview.tabParts"),
      href: "/preview",
      current: onParts,
      icon: LayoutGrid,
    },
    {
      key: "clock",
      label: t("bottomNav.clock"),
      href: "/preview/push",
      current: !onParts,
      icon: Clock,
    },
    {
      key: "hours",
      label: t("bottomNav.hours"),
      href: "/preview/push",
      current: false,
      icon: CalendarDays,
    },
    {
      key: "questions",
      label: t("bottomNav.questions"),
      href: "/preview/push",
      current: false,
      icon: MessageCircleQuestionMark,
      count: 2,
    },
  ];
}

export function PreviewNav({ variant }: { variant: "tabs" | "side" }) {
  const navItems = items(usePathname());
  return variant === "tabs" ? (
    <TabBar items={navItems} label={t("preview.navLabel")} />
  ) : (
    <SidebarNav items={navItems} label={t("preview.navLabel")} />
  );
}
