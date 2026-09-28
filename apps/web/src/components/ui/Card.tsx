import type { ReactNode } from "react";

import { cx } from "./cx";

export interface CardProps {
  children: ReactNode;
  /** Extra classes for layout only (grid placement, width). Never colours. */
  className?: string;
}

/** A quiet block on `fill`: no border, no shadow. */
export function Card({ children, className }: CardProps) {
  return <div className={cx("rounded-group bg-fill p-6", className)}>{children}</div>;
}
