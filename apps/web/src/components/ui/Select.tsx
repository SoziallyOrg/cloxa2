import type { SelectHTMLAttributes } from "react";

import { cx } from "./cx";

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "className"> & {
  /** `quiet`: a compact filter (e.g. the site filter), not a form field. */
  quiet?: boolean;
};

/**
 * A native select in the input look, with its own chevron. Native, so it
 * opens the phone's own picker and stays accessible.
 */
export function Select({ quiet = false, children, ...props }: SelectProps) {
  return (
    <span className={cx("relative flex", quiet ? "w-auto" : "w-full")}>
      <select
        {...props}
        className={cx(
          "focus-ring w-full cursor-pointer appearance-none rounded-control border-0 bg-fill pr-11 pl-4 text-ink",
          quiet ? "min-h-touch-target text-callout" : "min-h-row text-body",
          "aria-invalid:ring-2 aria-invalid:ring-danger",
        )}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 14 8"
        className="pointer-events-none absolute top-1/2 right-4 h-2 w-3.5 -translate-y-1/2 text-ink-2"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m1 1 6 6 6-6" />
      </svg>
    </span>
  );
}
