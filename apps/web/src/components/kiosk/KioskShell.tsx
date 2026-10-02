import type { ReactNode } from "react";

import { t } from "@cloxa/i18n";

import { Logo } from "../brand/Logo";
import { cx } from "../ui/cx";

/** The tablet's brand bar: the logo on forest, and one quiet line on the right. */
export function KioskHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="on-forest flex items-center justify-between gap-6 bg-forest px-8 py-5 text-white">
      <Logo size="lg" tone="on-forest" />
      {children ? <p className="text-title-3 text-on-forest-2">{children}</p> : null}
    </header>
  );
}

/** Header plus content on paper: for the name tiles, the PIN pad and the setup screens. */
export function KioskShell({
  children,
  tagline = false,
  className,
}: {
  children: ReactNode;
  /** Shows "Kies je naam om te klokken" in the bar. */
  tagline?: boolean;
  className?: string;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <KioskHeader>{tagline ? t("kiosk.brandTagline") : null}</KioskHeader>
      <div className={cx("flex flex-1 flex-col", className)}>{children}</div>
    </div>
  );
}
