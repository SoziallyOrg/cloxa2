import type { ReactNode } from "react";

import { cx } from "./cx";

export interface BottomNavItem {
  key: string;
  label: string;
  href: string;
  icon: ReactNode;
  current: boolean;
}

export interface BottomNavProps {
  /** At most 3 items: one obvious set of destinations, not a menu. */
  items: readonly BottomNavItem[];
}

/** Fixed, 64px-tall bottom navigation with an icon and a visible label. */
export function BottomNav({ items }: BottomNavProps) {
  const visibleItems = items.slice(0, 3);

  return (
    <nav className="h-bottom-nav w-full border-t border-border bg-surface">
      <ul className="flex h-full">
        {visibleItems.map((item) => (
          <li key={item.key} className="flex-1">
            <a
              href={item.href}
              aria-current={item.current ? "page" : undefined}
              className={cx(
                "focus-ring flex h-full flex-col items-center justify-center gap-1 text-base font-semibold",
                item.current ? "text-primary" : "text-ink/70",
              )}
            >
              {item.icon}
              <span>{item.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
