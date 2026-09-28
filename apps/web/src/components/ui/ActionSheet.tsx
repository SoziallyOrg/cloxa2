"use client";

import { useId } from "react";

import { t } from "@cloxa/i18n";

import { cx } from "./cx";
import { tap } from "./haptics";
import { ELEVATED, useModalDialog } from "./useModalDialog";

export interface ActionSheetAction {
  key: string;
  label: string;
  onSelect: () => void;
  /** Red, for actions that remove or undo something. */
  destructive?: boolean;
}

export interface ActionSheetProps {
  open: boolean;
  onClose: () => void;
  /** Small bold line on top: what the choice is about. */
  title: string;
  /** Optional plain-language consequence under the title. */
  message?: string;
  actions: readonly ActionSheetAction[];
}

const ACTION =
  "pressable focus-ring flex min-h-14 w-full items-center justify-center px-4 py-3 text-center text-title-3 focus-visible:-outline-offset-3";

/**
 * The iOS action sheet: a list of choices over the bottom of the screen, and
 * "Annuleer" on its own below. A destructive choice is red. Desktop shows the
 * same card centred. Picking a choice closes the sheet.
 */
export function ActionSheet({
  open,
  onClose,
  title,
  message,
  actions,
}: ActionSheetProps) {
  const { ref, requestClose } = useModalDialog(open, onClose);
  const titleId = useId();
  const messageId = useId();

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={message ? messageId : undefined}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
      className={cx(
        ELEVATED,
        "m-0 mt-auto w-full max-w-none border-0 bg-transparent p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-ink",
        "data-closing:animate-sheet-out open:motion-safe:animate-sheet-in",
        "backdrop:bg-black/40 open:backdrop:animate-fade-in data-closing:backdrop:animate-fade-out",
        "md:m-auto md:w-[min(26rem,calc(100%-3rem))] md:data-closing:animate-fade-out md:open:motion-safe:animate-alert-in",
      )}
    >
      <div className="overflow-hidden rounded-alert material-sheet">
        <div className="flex flex-col gap-1 px-4 py-3.5 text-center">
          <h2 id={titleId} className="text-subhead font-semibold text-ink-2">
            {title}
          </h2>
          {message ? (
            <p id={messageId} className="text-subhead text-ink-2">
              {message}
            </p>
          ) : null}
        </div>
        <ul>
          {actions.map((action) => (
            <li key={action.key} className="border-t-[0.5px] border-separator">
              <button
                type="button"
                className={cx(ACTION, action.destructive ? "text-danger" : "text-ink")}
                onClick={() => {
                  tap();
                  action.onSelect();
                  requestClose();
                }}
              >
                {action.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        onClick={requestClose}
        className={cx(ACTION, "mt-2 rounded-alert bg-surface font-semibold text-ink")}
      >
        {t("ui.cancel")}
      </button>
    </dialog>
  );
}
