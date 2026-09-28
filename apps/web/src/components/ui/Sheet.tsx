"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import { t } from "@cloxa/i18n";

export interface SheetProps {
  open: boolean;
  /** Called on Esc, a tap outside, "Sluiten", or when `open` turns false. */
  onClose: () => void;
  title: string;
  /** Plain-language consequences, right under the title. */
  description?: ReactNode;
  children: ReactNode;
}

/**
 * A bottom sheet on phones and a centred dialog on desktop. A native modal
 * `<dialog>`: the page behind is inert (focus stays inside), Esc closes it,
 * and focus returns to the control that opened it. Never `confirm()`.
 */
export function Sheet({ open, onClose, title, description, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      // The dialog box is filled by its content, so only a backdrop tap targets it.
      onClick={(event) => {
        if (event.target === event.currentTarget) ref.current?.close();
      }}
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-sheet border-0 bg-paper p-0 text-ink backdrop:bg-black/45 open:motion-safe:animate-sheet-in md:m-auto md:w-[min(30rem,calc(100%-3rem))] md:rounded-group dark:bg-fill"
    >
      <div className="flex flex-col gap-6 px-gutter pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-8 md:pt-6 md:pb-8">
        <div
          aria-hidden="true"
          className="mx-auto h-1.5 w-10 rounded-full bg-line md:hidden"
        />
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <h2 id={titleId} className="text-headline">
              {title}
            </h2>
            {description ? (
              <div className="text-body text-ink-2">{description}</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="focus-ring -mt-2 -mr-3 min-h-touch-target shrink-0 rounded-control px-3 text-body text-ink-2 hover:text-ink"
          >
            {t("common.close")}
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
