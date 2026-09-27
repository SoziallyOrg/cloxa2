import type { ReactNode } from "react";

import { cx } from "./cx";

export type HeadingLevel = 1 | 2 | 3;

export interface HeadingProps {
  level?: HeadingLevel;
  children: ReactNode;
  className?: string;
}

const LEVEL_CLASSES: Record<HeadingLevel, string> = {
  1: "text-2xl font-bold",
  2: "text-xl font-semibold",
  3: "text-lg font-semibold",
};

/** Semantic heading with a fixed, calm type scale — no ad hoc font sizes. */
export function Heading({ level = 1, children, className }: HeadingProps) {
  const Tag = `h${level}` as const;

  return <Tag className={cx(LEVEL_CLASSES[level], className)}>{children}</Tag>;
}
