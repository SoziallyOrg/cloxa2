"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

import { t } from "@cloxa/i18n";

import { ActivityIndicator } from "./ActivityIndicator";
import { cx } from "./cx";
import { tap } from "./haptics";

export interface PullToRefreshProps {
  children: ReactNode;
  /**
   * Layout for the wrapper and the moving content, e.g. "flex flex-1
   * flex-col" so a hero page can still push its actions to the bottom.
   */
  className?: string;
}

/** Pull this far (after resistance) to refresh. */
const THRESHOLD = 70;
/** Where the spinner rests while the page reloads. */
const REST = 52;
/** Keep the spinner up at least this long, so a fast refresh still registers. */
const MIN_SPIN_MS = 600;

/** Finger distance to pull distance: easy at first, heavier further down. */
function resist(distance: number): number {
  return Math.min(140, distance * 0.5);
}

/**
 * iOS pull-to-refresh for touch screens: pull down at the top of the page,
 * let go past the threshold, and the server data reloads
 * (`router.refresh()`). It only takes over a touch that starts at the very
 * top and moves down; every other touch scrolls as usual. Mouse and
 * keyboard users never see it.
 */
export function PullToRefresh({ children, className }: PullToRefreshProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [refreshing, setRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const startedAt = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    const indicator = indicatorRef.current;
    if (!container || !content || !indicator) return;

    let startY: number | null = null;
    let distance = 0;
    let pulling = false;
    let busy = false;

    const show = (offset: number, animate: boolean) => {
      const transition = animate ? "transform 350ms var(--ease-spring)" : "none";
      content.style.transition = transition;
      indicator.style.transition = `${transition}, opacity 200ms`;
      // No transform at rest: a transformed ancestor would break `position: fixed` inside.
      content.style.transform = offset > 0 ? `translateY(${offset}px)` : "";
      indicator.style.transform = `translateY(${offset - REST}px)`;
      indicator.style.opacity = String(Math.min(1, offset / THRESHOLD));
    };

    const onStart = (event: TouchEvent) => {
      startY =
        !busy && event.touches.length === 1 && window.scrollY <= 0
          ? (event.touches[0]?.clientY ?? null)
          : null;
      pulling = false;
      distance = 0;
    };

    const onMove = (event: TouchEvent) => {
      if (startY === null) return;
      const delta = (event.touches[0]?.clientY ?? startY) - startY;
      if (delta <= 0 || window.scrollY > 0) {
        if (pulling) show(0, false);
        pulling = false;
        if (window.scrollY > 0) startY = null;
        return;
      }
      pulling = true;
      // Only now does the pull replace the browser's own overscroll.
      event.preventDefault();
      distance = resist(delta);
      show(distance, false);
    };

    const onEnd = () => {
      startY = null;
      if (!pulling) return;
      pulling = false;
      if (distance >= THRESHOLD) {
        busy = true;
        show(REST, true);
        tap();
        startedAt.current = performance.now();
        setRefreshing(true);
        startTransition(() => router.refresh());
      } else {
        show(0, true);
      }
    };

    const release = () => {
      busy = false;
      show(0, true);
    };

    container.addEventListener("touchstart", onStart, { passive: true });
    container.addEventListener("touchmove", onMove, { passive: false });
    container.addEventListener("touchend", onEnd);
    container.addEventListener("touchcancel", onEnd);
    container.addEventListener("cx-refresh-done", release);
    return () => {
      container.removeEventListener("touchstart", onStart);
      container.removeEventListener("touchmove", onMove);
      container.removeEventListener("touchend", onEnd);
      container.removeEventListener("touchcancel", onEnd);
      container.removeEventListener("cx-refresh-done", release);
    };
  }, [router]);

  useEffect(() => {
    if (!refreshing || isPending) return;
    const wait = Math.max(0, MIN_SPIN_MS - (performance.now() - startedAt.current));
    const timer = window.setTimeout(() => {
      setRefreshing(false);
      containerRef.current?.dispatchEvent(new Event("cx-refresh-done"));
    }, wait);
    return () => window.clearTimeout(timer);
  }, [refreshing, isPending]);

  return (
    <div ref={containerRef} className={cx("relative", className)}>
      <div
        ref={indicatorRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-40 flex h-[52px] -translate-y-full items-center justify-center text-ink-2 opacity-0"
      >
        <ActivityIndicator />
      </div>
      <p aria-live="polite" className="sr-only">
        {refreshing ? t("ui.refreshing") : ""}
      </p>
      <div ref={contentRef} className={className}>
        {children}
      </div>
    </div>
  );
}
