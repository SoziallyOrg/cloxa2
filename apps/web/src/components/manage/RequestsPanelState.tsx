"use client";

import { createContext, use, useState, type ReactNode } from "react";

import { t } from "@cloxa/i18n";

import { cx } from "../ui/cx";

interface RequestsPanelValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const RequestsPanelContext = createContext<RequestsPanelValue | null>(null);

/**
 * Lets the title row's "Aanvragen n" button and the board share one flag:
 * below 1280px the requests tab lives in a sheet, and this opens it.
 */
export function RequestsPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <RequestsPanelContext value={{ open, setOpen }}>{children}</RequestsPanelContext>
  );
}

export function useRequestsPanel(): RequestsPanelValue {
  const value = use(RequestsPanelContext);
  if (!value) throw new Error("useRequestsPanel needs a RequestsPanelProvider");
  return value;
}

/**
 * "Aanvragen 2" in the title row, only below 1280px (the docked panel has the
 * tab itself) and only when something waits.
 */
export function RequestsPanelButton({ count }: { count: number }) {
  const { setOpen } = useRequestsPanel();
  if (count <= 0) return null;
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={() => setOpen(true)}
      className={cx(
        "focus-ring inline-flex min-h-bar-button pressable items-center justify-center gap-2 rounded-control border-[1.5px] border-line bg-card px-4 text-body font-bold text-ink xl:hidden",
      )}
    >
      {t("manageToday.tabRequests")}
      <span className="flex min-w-6 items-center justify-center rounded-full bg-lime px-2 text-caption text-forest-deep">
        {count}
      </span>
    </button>
  );
}
