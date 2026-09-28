import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

import { cx } from "./cx";
import type { NavItem } from "./TabBar";

export interface SidebarLayoutProps {
  /** Desktop only: the source list and anything around it (logo, account). */
  sidebar: ReactNode;
  /** Phones only: the `TabBar`, fixed at the bottom. */
  tabBar?: ReactNode;
  /** Full width (the timeline); lists and forms keep a ~720px column. */
  wide?: boolean;
  /** `grouped` (#f2f2f7) for inset grouped lists, `plain` (white) otherwise. */
  tone?: "grouped" | "plain";
  children: ReactNode;
}

/**
 * The app frame, as on iPadOS and macOS: a translucent sidebar on desktop,
 * a tab bar on phones, and the content in a readable column.
 */
export function SidebarLayout({
  sidebar,
  tabBar,
  wide = false,
  tone = "grouped",
  children,
}: SidebarLayoutProps) {
  return (
    <div className="min-h-dvh md:flex">
      <aside className="sticky top-0 z-20 hidden h-dvh w-sidebar shrink-0 flex-col gap-6 overflow-y-auto border-r-[0.5px] border-separator material-sidebar px-3 py-6 md:flex">
        {sidebar}
      </aside>
      <div
        className={cx(
          "flex min-h-dvh min-w-0 flex-1 flex-col",
          tone === "grouped" ? "bg-grouped" : "bg-paper",
          tabBar !== undefined &&
            tabBar !== null &&
            "pb-[calc(var(--spacing-tab-bar)+env(safe-area-inset-bottom))] md:pb-0",
        )}
      >
        <main
          className={cx(
            "flex w-full flex-1 flex-col",
            !wide && "mx-auto max-w-readable",
          )}
        >
          {children}
        </main>
      </div>
      {tabBar ? (
        <div className="fixed inset-x-0 bottom-0 z-30 md:hidden">{tabBar}</div>
      ) : null}
    </div>
  );
}

export interface SidebarNavProps {
  items: readonly NavItem[];
  label: string;
}

/**
 * The sidebar source list: an icon and a label per row, the current row on
 * a pressed-grey pill, counts right-aligned (visual only, like the tab
 * bar's badge). Rows stay 48px for seniors.
 */
export function SidebarNav({ items, label }: SidebarNavProps) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-col gap-0.5">
        {items.map(({ key, label: itemLabel, href, current, icon: Icon, count }) => (
          <li key={key}>
            <Link
              href={href as Route}
              aria-current={current ? "page" : undefined}
              className={cx(
                "focus-ring flex min-h-touch-target items-center gap-3 rounded-list px-3 text-body pressable",
                current ? "bg-pressed font-semibold text-ink" : "text-ink",
              )}
            >
              <Icon
                aria-hidden="true"
                className={cx(
                  "size-[22px] shrink-0",
                  current ? "text-ink" : "text-ink-2",
                )}
                strokeWidth={current ? 2.25 : 1.8}
              />
              <span className="min-w-0 flex-1 truncate">{itemLabel}</span>
              {count !== undefined && count > 0 ? (
                <span
                  aria-hidden="true"
                  className="text-subhead font-normal text-ink-2"
                >
                  {count}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
