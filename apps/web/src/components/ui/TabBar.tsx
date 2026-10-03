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
 * The phone tab bar: a solid white bar with a hairline on top. The active
 * item is a forest rounded tile with white text; icon and word always
 * together. Place it fixed at the bottom (see `SidebarLayout`).
 */
export function TabBar({ items, label }: TabBarProps) {
  return (
    <nav
      aria-label={label}
      className="border-t border-line bg-card pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex h-tab-bar max-w-readable items-stretch gap-1 px-2 py-2">
        {items
          .slice(0, 5)
          .map(({ key, label: itemLabel, href, current, icon: Icon, count }) => (
            <li key={key} className="min-w-0 flex-1">
              <Link
                href={href as Route}
                aria-current={current ? "page" : undefined}
                className={cx(
                  "focus-ring flex h-full pressable flex-col items-center justify-center gap-0.5 rounded-control",
                  current ? "on-forest bg-forest text-white" : "text-ink-2",
                )}
              >
                <span className="relative">
                  <Icon aria-hidden="true" className="size-6" strokeWidth={1.75} />
                  {count !== undefined && count > 0 ? (
                    <span
                      aria-hidden="true"
                      className="absolute -top-1 left-4 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-lime px-1 text-caption-2 text-forest-deep"
                    >
                      {count}
                    </span>
                  ) : null}
                </span>
                <span className="max-w-full truncate px-1 text-caption-2 font-bold">
                  {itemLabel}
                </span>
              </Link>
            </li>
          ))}
      </ul>
    </nav>
  );
}
