"use client";

import { useId } from "react";

import { t } from "@cloxa/i18n";

import { cx } from "./cx";
import { tap } from "./haptics";
import { useModalDialog } from "./useModalDialog";

export interface ActionSheetAction {
  key: string;
  label: string;
  onSelect: () => void;
  /** Red, for actions that remove or undo something. */
  destructive?: boolean;
  /** Forest, the preferred choice: e.g. the last one made. */
  preferred?: boolean;
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
  "pressable focus-ring flex min-h-control w-full items-center justify-center rounded-control px-4 py-3 text-center text-headline";

/**
 * A plain dialog with the choices as big buttons, "Annuleer" below. Bottom of
 * the screen on phones, centred on desktop. A destructive choice is red.
 * Picking a choice closes it.
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
        "m-0 mt-auto w-full max-w-none border-0 bg-transparent p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-ink",
        "data-closing:animate-sheet-out open:motion-safe:animate-sheet-in",
        "backdrop:bg-ink/50 open:backdrop:animate-fade-in data-closing:backdrop:animate-fade-out",
        "md:m-auto md:w-[min(26rem,calc(100%-3rem))] md:data-closing:animate-fade-out md:open:motion-safe:animate-alert-in",
      )}
    >
      <div className="flex flex-col gap-4 rounded-sheet bg-paper p-5">
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="text-title-3">
            {title}
          </h2>
          {message ? (
            <p id={messageId} className="text-subhead text-ink-2">
              {message}
            </p>
          ) : null}
        </div>
        <ul className="flex flex-col gap-2">
          {actions.map((action) => (
            <li key={action.key}>
              <button
                type="button"
                className={cx(
                  ACTION,
                  action.destructive
                    ? "bg-danger text-white"
                    : action.preferred
                      ? "bg-forest text-white"
                      : "border-[1.5px] border-line bg-card text-ink",
                )}
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
        <button
          type="button"
          onClick={requestClose}
          className={cx(ACTION, "text-ink-2")}
        >
          {t("ui.cancel")}
        </button>
      </div>
    </dialog>
  );
}
