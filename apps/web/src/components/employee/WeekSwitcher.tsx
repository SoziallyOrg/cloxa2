import Link from "next/link";
import type { Route } from "next";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { t } from "@cloxa/i18n";

import { cx } from "../ui/cx";

export interface WeekSwitcherProps {
  /** The range being shown, e.g. "28 sep – 4 okt". */
  label: string;
  previousHref: string;
  /** `null` on the current week: there is nothing newer to show. */
  nextHref: string | null;
  /** Set when an older week is shown: a way back to this week. */
  currentHref: string | null;
}

const SIDE =
  "focus-ring flex min-h-12 min-w-12 pressable items-center justify-center gap-1 rounded-[10px] px-3 text-subhead font-semibold text-ink";

/** The D toggle: previous week, the week shown (a white tile), next week. */
export function WeekSwitcher({
  label,
  previousHref,
  nextHref,
  currentHref,
}: WeekSwitcherProps) {
  return (
    <nav
      aria-label={t("hours.weekSwitcherLabel")}
      className="flex flex-wrap items-center gap-3"
    >
      <div className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1 rounded-[14px] bg-toggle p-1 lg:max-w-md">
        <Link href={previousHref as Route} className={SIDE}>
          <ChevronLeft aria-hidden="true" className="size-5" strokeWidth={2.5} />
          <span className="sr-only">{t("hours.weekPrevious")}</span>
        </Link>
        <p
          aria-live="polite"
          className="flex min-h-12 items-center justify-center truncate rounded-[10px] bg-thumb px-3 text-center text-subhead font-bold shadow-card"
        >
          {label}
        </p>
        {nextHref ? (
          <Link href={nextHref as Route} className={SIDE}>
            <ChevronRight aria-hidden="true" className="size-5" strokeWidth={2.5} />
            <span className="sr-only">{t("hours.weekNext")}</span>
          </Link>
        ) : (
          <span aria-hidden="true" className={cx(SIDE, "opacity-30")}>
            <ChevronRight className="size-5" strokeWidth={2.5} />
          </span>
        )}
      </div>
      {currentHref ? (
        <Link
          href={currentHref as Route}
          className="focus-ring flex min-h-12 pressable items-center rounded-control border-[1.5px] border-line bg-card px-4 text-subhead font-bold"
        >
          {t("hours.weekCurrent")}
        </Link>
      ) : null}
    </nav>
  );
}
