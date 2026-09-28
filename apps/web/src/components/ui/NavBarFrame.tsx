"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { cx } from "./cx";

export interface NavBarFrameProps {
  /** The inline title shown once collapsed (the large title is the `h1`). */
  title: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** The large title block, observed to decide when the bar collapses. */
  children: ReactNode;
  /** Page background under the bar before it collapses. */
  tone: "grouped" | "plain";
  wide: boolean;
}

/**
 * The client island of `NavBar`. One IntersectionObserver watches the large
 * title: once it has scrolled under the bar, the bar turns into translucent
 * material with a hairline and shows the inline title. No scroll handlers,
 * no layout reads while scrolling (the bar is measured once).
 */
export function NavBarFrame({
  title,
  leading,
  trailing,
  children,
  tone,
  wide,
}: NavBarFrameProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const largeRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const bar = barRef.current;
    const large = largeRef.current;
    if (!bar || !large || typeof IntersectionObserver === "undefined") return;
    const barHeight = Math.round(bar.getBoundingClientRect().height);
    const observer = new IntersectionObserver(
      ([entry]) => setCollapsed(entry ? !entry.isIntersecting : false),
      { rootMargin: `-${barHeight}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(large);
    return () => observer.disconnect();
  }, []);

  const column = wide ? "w-full" : "mx-auto w-full max-w-readable";

  return (
    <>
      <div
        ref={barRef}
        data-collapsed={collapsed || undefined}
        className={cx(
          "sticky top-0 z-30 border-b-[0.5px] border-transparent pt-[env(safe-area-inset-top)] transition-[background-color,border-color] duration-200",
          tone === "grouped" ? "bg-grouped" : "bg-paper",
          "data-collapsed:border-separator data-collapsed:material-bar",
        )}
      >
        <div
          className={cx(
            column,
            "grid h-nav-bar grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-2",
          )}
        >
          <div className="flex min-w-0 justify-start">{leading}</div>
          <p
            aria-hidden="true"
            className={cx(
              "truncate text-headline opacity-0 transition-opacity duration-200",
              // Hidden, it takes no width, so a back label has room (as on iOS).
              collapsed ? "max-w-[50vw] opacity-100 md:max-w-sm" : "max-w-0",
            )}
          >
            {title}
          </p>
          <div className="flex min-w-0 items-center justify-end gap-1">{trailing}</div>
        </div>
      </div>
      <div ref={largeRef} className={column}>
        {children}
      </div>
    </>
  );
}
