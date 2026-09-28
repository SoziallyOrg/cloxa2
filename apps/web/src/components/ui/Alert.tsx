"use client";

import { useId } from "react";

import { t } from "@cloxa/i18n";

import { cx } from "./cx";
import { ELEVATED, useModalDialog } from "./useModalDialog";

export interface AlertProps {
  open: boolean;
  /** Called once closed, whichever button (or Esc) closed it. */
  onClose: () => void;
  title: string;
  /** The consequence, in one or two plain sentences. */
  message?: string;
  confirmLabel: string;
  onConfirm: () => void;
  /** Red confirm button, for irreversible steps. */
  destructive?: boolean;
  /** "Annuleer" by default. */
  cancelLabel?: string;
}

const BUTTON =
  "pressable focus-ring min-h-touch-target px-3 py-2.5 text-body focus-visible:-outline-offset-3";

/**
 * The iOS alert: a small centred card with a title, a message and two
 * buttons side by side. For irreversible steps only; everyday choices use an
 * `ActionSheet`. A tap outside does nothing, as on iOS; Esc cancels.
 */
export function Alert({
  open,
  onClose,
  title,
  message,
  confirmLabel,
  onConfirm,
  destructive = false,
  cancelLabel,
}: AlertProps) {
  const { ref, requestClose } = useModalDialog(open, onClose);
  const titleId = useId();
  const messageId = useId();

  return (
    <dialog
      ref={ref}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={message ? messageId : undefined}
      className={cx(
        ELEVATED,
        "m-auto w-[min(18rem,calc(100%-3rem))] max-w-none overflow-hidden rounded-alert border-0 material-sheet p-0 text-ink",
        "data-closing:animate-fade-out open:motion-safe:animate-alert-in",
        "backdrop:bg-black/40 open:backdrop:animate-fade-in data-closing:backdrop:animate-fade-out",
      )}
    >
      <div className="flex flex-col gap-1 px-4 pt-5 pb-4 text-center">
        <h2 id={titleId} className="text-headline break-words">
          {title}
        </h2>
        {message ? (
          <p id={messageId} className="text-subhead text-ink">
            {message}
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-2 border-t-[0.5px] border-separator">
        <button
          type="button"
          onClick={requestClose}
          className={cx(
            BUTTON,
            "border-r-[0.5px] border-separator font-semibold text-ink",
          )}
        >
          {cancelLabel ?? t("ui.cancel")}
        </button>
        <button
          type="button"
          onClick={() => {
            onConfirm();
            requestClose();
          }}
          className={cx(BUTTON, destructive ? "text-danger" : "text-ink")}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
