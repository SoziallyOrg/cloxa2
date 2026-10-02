"use client";

import { useId } from "react";

import { t } from "@cloxa/i18n";

import { cx } from "./cx";
import { useModalDialog } from "./useModalDialog";

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
  "pressable focus-ring min-h-control rounded-control px-3 py-2.5 text-headline";

/**
 * A small centred dialog with a title, a message and two buttons. For
 * irreversible steps only; everyday choices use an `ActionSheet`. A tap
 * outside does nothing; Esc cancels.
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
        "m-auto w-[min(24rem,calc(100%-2rem))] max-w-none rounded-alert border-0 bg-card p-5 text-ink",
        "data-closing:animate-fade-out open:motion-safe:animate-alert-in",
        "backdrop:bg-ink/50 open:backdrop:animate-fade-in data-closing:backdrop:animate-fade-out",
      )}
    >
      <div className="flex flex-col gap-2">
        <h2 id={titleId} className="text-title-3 break-words">
          {title}
        </h2>
        {message ? (
          <p id={messageId} className="text-body text-ink-2">
            {message}
          </p>
        ) : null}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={requestClose}
          className={cx(BUTTON, "border-[1.5px] border-line bg-card text-ink")}
        >
          {cancelLabel ?? t("ui.cancel")}
        </button>
        <button
          type="button"
          onClick={() => {
            onConfirm();
            requestClose();
          }}
          className={cx(
            BUTTON,
            destructive ? "bg-danger text-white" : "bg-forest text-white",
          )}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
