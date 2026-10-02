"use client";

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { t } from "@cloxa/i18n";

import { cx } from "./cx";
import { Sheet } from "./Sheet";

interface SidePanelContextValue {
  target: HTMLElement | null;
  /** A page that fills the panel registers while it is mounted. */
  register: () => () => void;
}

const SidePanelContext = createContext<SidePanelContextValue | null>(null);

// 1280px: below that the main column needs the full width (docs/design.md → Layout).
const DESKTOP_QUERY = "(min-width: 80rem)";

function subscribeDesktop(onChange: () => void): () => void {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const isDesktop = () => window.matchMedia(DESKTOP_QUERY).matches;
const noDesktopOnServer = () => false;

/** Whether the side panel column exists (>= 1280px); false while server-rendering. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribeDesktop, isDesktop, noDesktopOnServer);
}

/**
 * Main column plus the optional 330px side panel, docked from 1280px (docs/design.md). The panel
 * renders nothing, takes no space, until a page fills it with `SidePanel`.
 */
export function SidePanelHost({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [filled, setFilled] = useState(0);

  const register = useCallback(() => {
    setFilled((count) => count + 1);
    return () => setFilled((count) => count - 1);
  }, []);

  return (
    <SidePanelContext value={{ target, register }}>
      <div className="flex min-w-0 flex-1">
        {children}
        <aside
          ref={setTarget}
          aria-label={t("shell.sidePanelLabel")}
          className={cx(
            "sticky top-0 h-dvh w-side-panel shrink-0 overflow-y-auto border-l border-line bg-card p-5",
            filled > 0 ? "hidden xl:block" : "hidden",
          )}
        />
      </div>
    </SidePanelContext>
  );
}

export interface SidePanelProps {
  /** The sheet's title when the panel is a sheet (below 1280px). */
  title: string;
  /** Sheet only: whether it is open (e.g. a person is selected). Ignored on desktop. */
  sheetOpen?: boolean;
  onSheetClose?: () => void;
  children: ReactNode;
}

/**
 * Context for the current selection. Wide desktop (>= 1280px): rendered in the
 * side panel. Below that: the same content in a `Sheet`, opened by the page.
 * Rendered in one place only, so ids and form fields never double up.
 */
export function SidePanel({
  title,
  sheetOpen = false,
  onSheetClose,
  children,
}: SidePanelProps) {
  const context = use(SidePanelContext);
  if (!context) throw new Error("SidePanel needs a SidePanelHost (the app frame)");
  const { target, register } = context;
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, noDesktopOnServer);

  useEffect(() => register(), [register]);

  if (desktop) return target ? createPortal(children, target) : null;
  return (
    <Sheet open={sheetOpen} onClose={onSheetClose ?? noop} title={title}>
      {children}
    </Sheet>
  );
}

function noop() {}
