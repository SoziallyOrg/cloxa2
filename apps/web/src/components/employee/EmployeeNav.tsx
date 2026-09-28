"use client";

import { usePathname } from "next/navigation";

import { CalendarDays, Clock, MessageCircleQuestionMark } from "lucide-react";

import { t } from "@cloxa/i18n";

import { SidebarNav } from "../ui/SidebarLayout";
import { TabBar, type NavItem } from "../ui/TabBar";

function navItems(pathname: string): NavItem[] {
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
      icon: MessageCircleQuestionMark,
      current: pathname.startsWith("/app/vragen"),
    },
  ];
}

/** Klok, Uren, Vragen: a bottom tab bar on phones, a quiet sidebar on desktop. */
export function EmployeeNav({ variant }: { variant: "tabs" | "side" }) {
  const items = navItems(usePathname());
  return variant === "tabs" ? (
    <TabBar items={items} label={t("bottomNav.label")} />
  ) : (
    <SidebarNav items={items} label={t("bottomNav.label")} />
  );
}
