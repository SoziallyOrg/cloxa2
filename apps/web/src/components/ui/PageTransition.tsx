/// <reference types="react/canary" />
import { ViewTransition, type ReactNode } from "react";

import { cx } from "./cx";

export interface PageTransitionProps {
  children: ReactNode;
  className?: string;
}

const DIRECTIONS = {
  "nav-forward": "nav-forward",
  "nav-back": "nav-back",
  default: "none",
};

/**
 * Wraps one page's content (in `page.tsx`, never a layout: layouts persist,
 * so they never enter or exit). Links tagged `PUSH` slide the new page in
 * from the right, `POP` slides it back out. Anything untagged (tabs, browser
 * back, `router.refresh()`) swaps without motion. Browsers without the View
 * Transitions API, and reduced motion, get a plain swap.
 */
export function PageTransition({ children, className }: PageTransitionProps) {
  return (
    <ViewTransition enter={DIRECTIONS} exit={DIRECTIONS} default="none">
      <div className={cx("min-w-0", className)}>{children}</div>
    </ViewTransition>
  );
}
