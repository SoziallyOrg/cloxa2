import type { ElementType, ReactNode } from "react";

import { cx } from "./cx";

export type StackGap = "sm" | "md" | "lg";

export interface StackProps {
  children: ReactNode;
  gap?: StackGap;
  /** Renders a horizontal row instead of a column. */
  row?: boolean;
  as?: ElementType;
  className?: string;
}

const GAP_CLASSES: Record<StackGap, string> = {
  sm: "gap-2",
  md: "gap-4",
  lg: "gap-8",
};

/** Vertical (default) or horizontal layout primitive with consistent spacing. */
export function Stack({
  children,
  gap = "md",
  row = false,
  as: Element = "div",
  className,
}: StackProps) {
  return (
    <Element
      className={cx(
        "flex",
        row ? "flex-row items-center" : "flex-col",
        GAP_CLASSES[gap],
        className,
      )}
    >
      {children}
    </Element>
  );
}
