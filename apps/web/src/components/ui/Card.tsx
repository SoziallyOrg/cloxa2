import type { ReactNode } from "react";

import { cx } from "./cx";

export interface CardProps {
  children: ReactNode;
  /** Extra classes for layout only (grid placement, width). Never colours. */
  className?: string;
}

/** Flat surface, generous padding, a hairline border — no shadows or gradients. */
export function Card({ children, className }: CardProps) {
  return (
    <div className={cx("rounded-lg border border-border bg-surface p-6", className)}>
      {children}
    </div>
  );
}
