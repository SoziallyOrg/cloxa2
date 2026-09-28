"use client";

import { usePathname } from "next/navigation";

import { t } from "@cloxa/i18n";

import { SideNav, TabBar, type NavItem } from "../ui/TabBar";

function navItems(pathname: string): NavItem[] {
  return [
    {
      key: "clock",
      label: t("bottomNav.clock"),
      href: "/app",
      current: pathname === "/app",
    },
    {
      key: "hours",
      label: t("bottomNav.hours"),
      href: "/app/uren",
      current: pathname.startsWith("/app/uren"),
    },
    {
      key: "questions",
      label: t("bottomNav.questions"),
      href: "/app/vragen",
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
    <SideNav items={items} label={t("bottomNav.label")} />
  );
}
