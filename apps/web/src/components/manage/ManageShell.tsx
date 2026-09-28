import type { ReactNode } from "react";

import { t } from "@cloxa/i18n";

import { requireManager } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

import { Logo } from "../brand/Logo";
import { shortDisplayName } from "../employee/AppShell";
import { cx } from "../ui/cx";
import { SideNav, TabBar, type NavItem } from "../ui/TabBar";
import { ManageAccountMenu } from "./ManageAccountMenu";

export type ManageNavKey = "today" | "questions" | "team" | "exports" | "more";

export interface ManageShellProps {
  active: ManageNavKey;
  /** Vandaag's timeline needs the full width; lists read better narrower. */
  wide?: boolean;
  children: ReactNode;
}

/**
 * The frame of every `/manage` page. Desktop: a quiet sidebar with the
 * logotype, text items with counts, and the manager's name at the bottom
 * (the account sheet). Phones: the logotype and name on top, four tabs at
 * the bottom. Reads its own counts, so every page shows the same numbers.
 */
export async function ManageShell({ active, wide = false, children }: ManageShellProps) {
  const context = await requireManager();
  const supabase = await createClient();

  const [pending, team, me] = await Promise.all([
    supabase
      .from("correction_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("employees")
      .select("id", { count: "exact", head: true })
      .eq("active", true)
      .is("left_at", null),
    context.employeeId
      ? supabase
          .from("employees")
          .select("display_name")
          .eq("id", context.employeeId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const fullName = me.data?.display_name ?? context.claims.email ?? t("account.open");
  const account = {
    shortName: me.data ? shortDisplayName(me.data.display_name) : t("account.open"),
    fullName,
    showSwitchToEmployee: context.employeeId !== null,
  };

  const item = (
    key: ManageNavKey,
    label: string,
    href: string,
    count?: number,
  ): NavItem => ({
    key,
    label,
    href,
    current: active === key,
    ...(count !== undefined ? { count } : {}),
  });

  const sidebar: NavItem[] = [
    item("today", t("manageNav.today"), "/manage"),
    item("questions", t("manageNav.questions"), "/manage/vragen", pending.count ?? 0),
    item("team", t("manageNav.team"), "/manage/team", team.count ?? 0),
    item("exports", t("manageNav.exports"), "/manage/meer/exports"),
    item("more", t("manageNav.more"), "/manage/meer"),
  ];
  // Exports lives under Meer on phones: four tabs at most.
  const tabs: NavItem[] = [
    sidebar[0]!,
    sidebar[1]!,
    sidebar[2]!,
    { ...sidebar[4]!, current: active === "more" || active === "exports" },
  ];

  return (
    <div className="min-h-dvh md:flex">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-10 border-r border-line px-5 py-8 md:flex">
        <div className="px-3">
          <Logo />
        </div>
        <SideNav items={sidebar} label={t("bottomNav.label")} />
        <div className="mt-auto">
          <ManageAccountMenu {...account} placement="sidebar" />
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between px-gutter pt-[env(safe-area-inset-top)] md:hidden">
          <Logo />
          <ManageAccountMenu {...account} placement="header" />
        </header>
        <main
          className={cx(
            "mx-auto flex w-full flex-1 flex-col gap-section px-gutter pt-4 pb-[calc(var(--spacing-tab-bar)+env(safe-area-inset-bottom)+2rem)] md:px-gutter-desktop md:pt-14 md:pb-16",
            wide ? "max-w-6xl" : "max-w-3xl",
          )}
        >
          {children}
        </main>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 md:hidden">
        <TabBar items={tabs} label={t("bottomNav.label")} />
      </div>
    </div>
  );
}
