"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { t } from "@cloxa/i18n";

import { cx } from "./cx";

export type NoticeTone = "info" | "success" | "error";

export interface NoticeProps {
  tone: NoticeTone;
  children: ReactNode;
  onDismiss?: () => void;
  /** Takes focus when it appears (default), so it is not missed on a long page. */
  autoFocus?: boolean;
}

const TONE_CLASSES: Record<NoticeTone, string> = {
  info: "text-ink",
  success: "font-medium text-working",
  error: "font-medium text-danger",
};

/**
 * An inline note, placed next to what caused it. Announces itself
 * (`role="status"` for info and success, `role="alert"` for errors) and
 * takes focus so it isn't missed on a long page.
 */
export function Notice({ tone, children, onDismiss, autoFocus = true }: NoticeProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "focus-ring flex items-start justify-between gap-4 rounded-control bg-fill py-3 pr-2 pl-4 text-body",
        TONE_CLASSES[tone],
      )}
    >
      <p className="py-1">{children}</p>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("ui.dismiss")}
          className="focus-ring min-h-touch-target shrink-0 rounded-control px-3 text-subhead font-normal text-ink-2 pressable"
        >
          {t("common.close")}
        </button>
      ) : null}
    </div>
  );
}
