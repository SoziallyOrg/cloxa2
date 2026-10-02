import type { ReactNode } from "react";

import { cx } from "./cx";

export interface DataTableProps {
  /** The accessible name of the table. */
  label: string;
  children: ReactNode;
  className?: string;
}

/**
 * A real table for desktop: a white card, quiet header row, hairlines between
 * rows. It scrolls sideways inside its card instead of breaking the page.
 */
export function DataTable({ label, children, className }: DataTableProps) {
  return (
    <div className={cx("overflow-x-auto rounded-card bg-card shadow-card", className)}>
      <table aria-label={label} className="w-full border-collapse text-left">
        {children}
      </table>
    </div>
  );
}

export function DataHead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-line">{children}</tr>
    </thead>
  );
}

export function Th({
  children,
  align = "left",
  className,
}: {
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cx(
        "px-4 py-3 text-caption whitespace-nowrap text-ink-2",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export interface TrProps {
  children: ReactNode;
  /** The row is the current selection (soft green fill). */
  selected?: boolean;
  /** Mouse convenience only: the keyboard path is a button inside the row. */
  onSelect?: () => void;
}

export function Tr({ children, selected = false, onSelect }: TrProps) {
  return (
    <tr
      data-selected={selected || undefined}
      onClick={onSelect}
      className={cx(
        "border-t border-line first:border-t-0",
        selected && "bg-working-tint",
        onSelect && "cursor-pointer",
      )}
    >
      {children}
    </tr>
  );
}

export function Td({
  children,
  align = "left",
  className,
}: {
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={cx(
        "min-h-14 px-4 py-3 align-middle text-callout",
        align === "right" && "text-right",
        className,
      )}
    >
      {children}
    </td>
  );
}

/** Statuut, module and status labels in tables: an outlined word, never colour alone. */
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "forest" | "break" | "danger";
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-control px-2.5 py-0.5 text-caption whitespace-nowrap",
        tone === "neutral" && "bg-fill text-ink",
        tone === "forest" && "bg-working-tint text-forest",
        tone === "break" && "bg-break-tint text-break-ink",
        tone === "danger" && "bg-danger-tint text-danger-tint-ink",
      )}
    >
      {children}
    </span>
  );
}
