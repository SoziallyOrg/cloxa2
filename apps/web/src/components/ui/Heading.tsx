import type { ReactNode } from "react";

import { cx } from "./cx";

export type HeadingLevel = 1 | 2 | 3;

export interface HeadingProps {
  level?: HeadingLevel;
  children: ReactNode;
  className?: string;
}

const LEVEL_CLASSES: Record<HeadingLevel, string> = {
  1: "text-title",
  2: "text-title-2 font-semibold",
  3: "text-body font-semibold",
};

/** Semantic heading on the type scale: title, headline, then body semibold. */
export function Heading({ level = 1, children, className }: HeadingProps) {
  const Tag = `h${level}` as const;

  return <Tag className={cx(LEVEL_CLASSES[level], className)}>{children}</Tag>;
}
