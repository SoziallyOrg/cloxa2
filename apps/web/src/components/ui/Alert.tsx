"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { t } from "@cloxa/i18n";

import { cx } from "./cx";

export type AlertTone = "info" | "success" | "error";

export interface AlertProps {
  tone: AlertTone;
  children: ReactNode;
  onDismiss?: () => void;
}

const TONE_CLASSES: Record<AlertTone, string> = {
  info: "bg-status-off-bg text-ink border-border",
  success: "bg-status-working-bg text-status-working border-status-working",
  error: "bg-status-error-bg text-status-error border-status-error",
};

/**
 * Announces itself to assistive tech immediately (`role="status"` for info
 * and success, `role="alert"` for errors) and moves focus to itself so it
 * isn't missed on a long page.
 */
export function Alert({ tone, children, onDismiss }: AlertProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "focus-ring flex items-start justify-between gap-4 rounded-md border-2 p-4 text-lg",
        TONE_CLASSES[tone],
      )}
    >
      <p>{children}</p>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("ui.dismiss")}
          className="focus-ring shrink-0 text-lg font-semibold underline"
        >
          {t("common.close")}
        </button>
      ) : null}
    </div>
  );
}
