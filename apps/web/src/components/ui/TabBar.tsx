import Link from "next/link";
import type { Route } from "next";

import { cx } from "./cx";

export interface NavItem {
  key: string;
  label: string;
  href: string;
  current: boolean;
  /** Right-aligned count in the desktop sidebar. */
  count?: number;
}

export interface TabBarProps {
  /** 3–4 destinations with text labels, never a menu. */
  items: readonly NavItem[];
  label: string;
}

/**
 * Phone navigation: a bottom bar of text labels. The active tab is ink and
 * semibold; the others are `ink-2`, which keeps 15px labels at AA contrast.
 */
export function TabBar({ items, label }: TabBarProps) {
  return (
    <nav
      aria-label={label}
      className="border-t border-line bg-paper/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl"
    >
      <ul className="flex h-tab-bar">
        {items.slice(0, 4).map((item) => (
          <li key={item.key} className="flex-1">
            <Link
              href={item.href as Route}
              aria-current={item.current ? "page" : undefined}
              className={cx(
                "focus-ring flex h-full items-center justify-center rounded-control text-callout focus-visible:-outline-offset-3",
                item.current ? "font-semibold text-ink" : "text-ink-2",
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Desktop navigation: quiet text items, the active one on `fill`. */
export function SideNav({ items, label }: TabBarProps) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href as Route}
              aria-current={item.current ? "page" : undefined}
              className={cx(
                "focus-ring flex min-h-touch-target items-center justify-between gap-3 rounded-control px-3 text-body",
                item.current
                  ? "bg-fill font-semibold text-ink"
                  : "text-ink-2 hover:bg-fill hover:text-ink",
              )}
            >
              <span>{item.label}</span>
              {item.count !== undefined && item.count > 0 ? (
                <span className="text-callout font-normal text-ink-2">
                  {item.count}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
