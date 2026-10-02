import Link from "next/link";
import { ChartNoAxesGantt, Clock } from "lucide-react";

import { t } from "@cloxa/i18n";

import { cx } from "./cx";
import { shouldShowRoleSwitch } from "./role-switch";

export interface RoleSwitchProps {
  /** The area being shown. */
  current: "app" | "manage";
  hasEmployee: boolean;
  canManage: boolean;
  /** `on-forest` for the clock hero (lime tile), `on-light` everywhere else. */
  tone?: "on-light" | "on-forest";
  /** `icons`: two stacked icon links for the narrow tablet sidebar. */
  variant?: "toggle" | "icons";
  className?: string;
}

/**
 * Two links, `/app` and `/manage`, drawn as the D toggle. Going to `/manage`
 * may trigger the MFA step; that is the existing gate working as intended.
 */
export function RoleSwitch({
  current,
  hasEmployee,
  canManage,
  tone = "on-light",
  variant = "toggle",
  className,
}: RoleSwitchProps) {
  if (!shouldShowRoleSwitch({ hasEmployee, canManage })) return null;

  const items = [
    { key: "app", href: "/app", label: t("shell.roleSwitchClock") },
    { key: "manage", href: "/manage", label: t("shell.roleSwitchManage") },
  ] as const;
  const onForest = tone === "on-forest";

  if (variant === "icons") {
    const icons = { app: Clock, manage: ChartNoAxesGantt } as const;
    return (
      <nav
        aria-label={t("shell.roleSwitchLabel")}
        className={cx("flex flex-col gap-1 rounded-[14px] bg-toggle p-1", className)}
      >
        {items.map((item) => {
          const active = item.key === current;
          const Icon = icons[item.key];
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? "page" : undefined}
              aria-label={item.label}
              className={cx(
                "focus-ring flex min-h-touch-target pressable items-center justify-center rounded-[10px]",
                active ? "bg-thumb text-ink shadow-card" : "text-ink-2",
              )}
            >
              <Icon aria-hidden="true" className="size-6" strokeWidth={1.75} />
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav
      aria-label={t("shell.roleSwitchLabel")}
      className={cx(
        "grid grid-cols-2 gap-1 rounded-[14px] p-1",
        onForest ? "on-forest bg-black/20" : "bg-toggle",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.key === current;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "focus-ring flex min-h-10 pressable items-center justify-center rounded-[10px] px-3 text-center text-subhead whitespace-nowrap",
              active
                ? onForest
                  ? "bg-lime font-bold text-forest-deep"
                  : "bg-thumb font-bold text-ink shadow-card"
                : onForest
                  ? "font-semibold text-on-forest-2"
                  : "font-semibold text-ink-2",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
