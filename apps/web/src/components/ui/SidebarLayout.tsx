import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

import { cx } from "./cx";
import { SidePanelHost } from "./SidePanel";
import type { NavItem } from "./TabBar";

export interface SidebarLayoutProps {
  /** Tablet and desktop: logo, role switch, nav, account (see `SidebarNav`). */
  sidebar: ReactNode;
  /** Phones: logo left, role switch right, above the content. */
  topBar?: ReactNode;
  /** Phones: the `TabBar`, fixed at the bottom. */
  tabBar?: ReactNode;
  /** Room for the clock bar above the tab bar / along the bottom. */
  contentEnd?: ReactNode;
  /** Full width (the timeline, tables); lists and forms keep a ~720px column. */
  wide?: boolean;
  children: ReactNode;
}

/**
 * The app frame (docs/design.md → Layout). Phone: top row, content on paper,
 * tab bar. 768-1023px: the sidebar shrinks to icons. >= 1024px: the 244px white
 * sidebar, a fluid main column and an optional 330px side panel (`SidePanel`).
 */
export function SidebarLayout({
  sidebar,
  topBar,
  tabBar,
  contentEnd,
  wide = false,
  children,
}: SidebarLayoutProps) {
  return (
    <div className="min-h-dvh bg-paper md:flex">
      <aside className="sticky top-0 z-20 hidden h-dvh w-sidebar-icons shrink-0 flex-col gap-5 overflow-x-hidden overflow-y-auto border-r border-line bg-card px-3 py-5 md:flex lg:w-sidebar lg:px-4">
        {sidebar}
      </aside>
      <SidePanelHost>
        <div
          className={cx(
            "flex min-h-dvh min-w-0 flex-1 flex-col",
            tabBar !== undefined &&
              tabBar !== null &&
              "pb-[calc(var(--spacing-tab-bar)+env(safe-area-inset-bottom))] md:pb-0",
          )}
        >
          {topBar ? (
            <div className="px-gutter pt-[calc(env(safe-area-inset-top)+0.75rem)] md:hidden">
              {topBar}
            </div>
          ) : null}
          <main
            className={cx(
              "flex w-full flex-1 flex-col",
              wide ? "max-w-main" : "max-w-readable",
            )}
          >
            {children}
          </main>
          {contentEnd}
        </div>
      </SidePanelHost>
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
 * The sidebar navigation: an icon and a label per item, the current one a
 * forest tile with white text, counts as lime badges. Items stay 48px. On
 * tablets (768-1023px) only the icons show; the label stays for screen readers.
 */
export function SidebarNav({ items, label }: SidebarNavProps) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-col gap-1">
        {items.map(({ key, label: itemLabel, href, current, icon: Icon, count }) => {
          const showCount = count !== undefined && count > 0;
          return (
            <li key={key}>
              <Link
                href={href as Route}
                aria-current={current ? "page" : undefined}
                className={cx(
                  "focus-ring flex min-h-touch-target pressable items-center justify-center gap-3 rounded-control px-3 text-body lg:justify-start",
                  current
                    ? "on-forest bg-forest font-bold text-white"
                    : "font-semibold text-ink",
                )}
              >
                <span className="relative flex shrink-0">
                  <Icon
                    aria-hidden="true"
                    className={cx("size-[22px]", !current && "text-ink-2")}
                    strokeWidth={1.75}
                  />
                  {showCount ? (
                    <span
                      aria-hidden="true"
                      className="absolute -top-2 -right-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-lime px-1 text-caption-2 text-forest-deep lg:hidden"
                    >
                      {count}
                    </span>
                  ) : null}
                </span>
                <span className="sr-only min-w-0 flex-1 truncate lg:not-sr-only">
                  {itemLabel}
                </span>
                {showCount ? (
                  <span
                    aria-hidden="true"
                    className="hidden min-w-6 items-center justify-center rounded-full bg-lime px-2 text-caption text-forest-deep lg:flex"
                  >
                    {count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
