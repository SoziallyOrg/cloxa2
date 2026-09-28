import Link from "next/link";
import type { Route } from "next";
import type { LucideIcon } from "lucide-react";
import { Ellipsis, Inbox, LayoutGrid, Users } from "lucide-react";
import type { ReactNode } from "react";

import { t } from "@cloxa/i18n";

import { cx } from "../ui/cx";
import { TabBar, type NavItem } from "../ui/TabBar";

export type ManageNavKey = "today" | "questions" | "team" | "more";

export interface ManageShellProps {
  active: ManageNavKey;
  /** Pending correction requests, shown as a badge on "Aanvragen". */
  pendingQuestionsCount?: number;
  /** A manager who is also an employee needs a clear switch to `/app`. */
  showSwitchToEmployee?: boolean;
  children: ReactNode;
}

interface NavEntry {
  key: ManageNavKey;
  label: string;
  href: string;
  icon: LucideIcon;
}

/**
 * The shared frame for every `/manage` page: a side rail on desktop, a
 * bottom nav (at most 4 items) on phones.
 */
export function ManageShell({
  active,
  pendingQuestionsCount = 0,
  showSwitchToEmployee = false,
  children,
}: ManageShellProps) {
  const questionsLabel =
    pendingQuestionsCount > 0
      ? t("manageNav.questionsWithCount", { count: pendingQuestionsCount })
      : t("manageNav.questions");

  const entries: NavEntry[] = [
    { key: "today", label: t("manageNav.today"), href: "/manage", icon: LayoutGrid },
    {
      key: "questions",
      label: questionsLabel,
      href: "/manage/vragen",
      icon: Inbox,
    },
    {
      key: "team",
      label: t("manageNav.team"),
      href: "/manage/team",
      icon: Users,
    },
    {
      key: "more",
      label: t("manageNav.more"),
      href: "/manage/meer",
      icon: Ellipsis,
    },
  ];

  const navItems: NavItem[] = entries.map((entry) => ({
    key: entry.key,
    label: entry.label,
    href: entry.href,
    icon: entry.icon,
    current: active === entry.key,
  }));

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl">
      <nav className="hidden w-56 shrink-0 flex-col gap-1 border-r border-line p-4 md:flex">
        {entries.map((entry) => (
          <Link
            key={entry.key}
            href={entry.href as Route}
            aria-current={active === entry.key ? "page" : undefined}
            className={cx(
              "focus-ring flex min-h-touch-target items-center gap-3 rounded-md px-3 text-lg font-semibold",
              active === entry.key ? "bg-fill text-ink" : "text-ink-2",
            )}
          >
            <span>{entry.label}</span>
          </Link>
        ))}
        {showSwitchToEmployee ? (
          <Link
            href={"/app" as Route}
            className="focus-ring mt-4 flex min-h-touch-target items-center rounded-md border border-line px-3 text-lg font-semibold text-ink"
          >
            {t("manageNav.switchToEmployee")}
          </Link>
        ) : null}
      </nav>

      <div className="flex w-full flex-col">
        <main className="flex-1 px-4 py-6 pb-28 md:pb-6">{children}</main>
        <div className="fixed inset-x-0 bottom-0 md:hidden">
          <TabBar items={navItems} label={t("bottomNav.label")} />
        </div>
      </div>
    </div>
  );
}
