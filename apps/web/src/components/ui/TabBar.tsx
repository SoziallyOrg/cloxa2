import Link from "next/link";
import type { Route } from "next";
import type { LucideIcon } from "lucide-react";

import { cx } from "./cx";

export interface NavItem {
  key: string;
  label: string;
  href: string;
  current: boolean;
  /** A Lucide icon, always shown with the label. */
  icon: LucideIcon;
  /**
   * A count badge (tab bar) or right-aligned count (sidebar). Visual only:
   * put the count in `label` too if it matters to screen readers.
   */
  count?: number;
}

export interface TabBarProps {
  /** 3–5 destinations, each an icon plus a label, never a menu. */
  items: readonly NavItem[];
  label: string;
}

/**
 * The iOS tab bar: translucent material with a hairline on top, above the
 * home indicator. The active tab is ink with a bolder, filled icon; the
 * others are `ink-2` (AA even at 11px). Place it fixed at the bottom (see
 * `SidebarLayout`).
 */
export function TabBar({ items, label }: TabBarProps) {
  return (
    <nav
      aria-label={label}
      className="border-t-[0.5px] border-separator material-bar pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex h-tab-bar max-w-readable">
        {items
          .slice(0, 5)
          .map(({ key, label: itemLabel, href, current, icon: Icon, count }) => (
            <li key={key} className="min-w-0 flex-1">
              <Link
                href={href as Route}
                aria-current={current ? "page" : undefined}
                className={cx(
                  "focus-ring flex h-full flex-col items-center justify-center gap-0.5 rounded-control pt-1 pressable focus-visible:-outline-offset-3",
                  current ? "text-ink" : "text-ink-2",
                )}
              >
                <span className="relative">
                  <Icon
                    aria-hidden="true"
                    className="size-6"
                    strokeWidth={current ? 2.4 : 1.8}
                    fill={current ? "currentColor" : "none"}
                    fillOpacity={current ? 0.16 : 0}
                  />
                  {count !== undefined && count > 0 ? (
                    <span
                      aria-hidden="true"
                      className="absolute -top-1 left-4 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-attention px-1 text-caption-2 font-semibold text-paper"
                    >
                      {count}
                    </span>
                  ) : null}
                </span>
                <span
                  className={cx(
                    "max-w-full truncate px-1 text-caption-2",
                    current ? "font-semibold" : "font-medium",
                  )}
                >
                  {itemLabel}
                </span>
              </Link>
            </li>
          ))}
      </ul>
    </nav>
  );
}
