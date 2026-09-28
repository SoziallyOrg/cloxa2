import { t } from "@cloxa/i18n";

import { cx } from "./cx";

export interface SkeletonProps {
  /** Size and shape only, e.g. "h-4 w-32" or "size-6 rounded-full". */
  className?: string;
}

/** A quiet placeholder block that gently pulses (still under reduced motion). */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cx("block rounded-md bg-line motion-safe:animate-shimmer", className)}
    />
  );
}

export interface SkeletonListProps {
  /** Number of rows. */
  rows?: number;
  /** A header line above the group. */
  header?: boolean;
  /** A leading line icon per row. */
  icon?: boolean;
  /** A second line per row. */
  subtitle?: boolean;
  /** A trailing value per row. */
  value?: boolean;
}

// Varied widths read as text, not as a grid of bars.
const TITLE_WIDTHS = ["w-2/5", "w-1/2", "w-1/3", "w-3/5", "w-[45%]"];
const SUBTITLE_WIDTHS = ["w-1/4", "w-1/3", "w-1/5", "w-2/5", "w-[30%]"];

/**
 * The loading shape of a `Section`, for `loading.tsx`. Screen readers hear
 * one "Bezig met laden" instead of empty rows.
 */
export function SkeletonList({
  rows = 5,
  header = false,
  icon = false,
  subtitle = false,
  value = false,
}: SkeletonListProps) {
  return (
    <div role="status" className="flex flex-col">
      <span className="sr-only">{t("ui.loadingContent")}</span>
      {header ? <Skeleton className="mb-3 ml-4 h-3.5 w-24" /> : null}
      <ul aria-hidden="true" className="overflow-hidden rounded-list bg-surface">
        {Array.from({ length: rows }, (_, row) => (
          <li key={row} className="group/row flex items-center">
            {icon ? (
              <Skeleton className="ml-4 size-[22px] shrink-0 rounded-full" />
            ) : null}
            <span
              className={cx(
                "flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-4 group-not-first/row:border-t-[0.5px] group-not-first/row:border-separator",
                icon ? "ml-3" : "ml-4",
                subtitle ? "min-h-row-two-line" : "min-h-row",
              )}
            >
              <span className="flex flex-1 flex-col gap-2">
                <Skeleton
                  className={cx("h-4", TITLE_WIDTHS[row % TITLE_WIDTHS.length])}
                />
                {subtitle ? (
                  <Skeleton
                    className={cx("h-3", SUBTITLE_WIDTHS[row % SUBTITLE_WIDTHS.length])}
                  />
                ) : null}
              </span>
              {value ? <Skeleton className="h-4 w-14" /> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The loading shape of a `NavBar` large title. */
export function SkeletonTitle() {
  return (
    <div
      aria-hidden="true"
      className="px-gutter pt-[calc(var(--spacing-nav-bar)+0.25rem)] pb-3"
    >
      <Skeleton className="h-9 w-48 rounded-lg" />
    </div>
  );
}
