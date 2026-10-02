"use client";

import { useId, useRef, useState, type PointerEvent, type ReactNode } from "react";

import { t } from "@cloxa/i18n";

import { cx } from "./cx";
import { useModalDialog } from "./useModalDialog";

export type SheetDetent = "medium" | "large";

export interface SheetProps {
  open: boolean;
  /** Called once closed: Esc, a tap outside, the close button, a drag down, or `open` turning false. */
  onClose: () => void;
  title: string;
  /** Plain-language consequences, right under the title. */
  description?: ReactNode;
  children: ReactNode;
  /**
   * Phones: `medium` opens at half height and can be dragged up to `large`;
   * `large` fills the screen below the status bar. Unset, the sheet fits its
   * content. Desktop always shows a centred card.
   */
  detent?: SheetDetent;
  /** The close button's label ("Sluiten" by default, "Klaar" after edits). */
  closeLabel?: string;
}

const HEIGHT: Record<SheetDetent | "fit", string> = {
  fit: "max-h-[calc(100dvh-env(safe-area-inset-top)-0.75rem)]",
  medium: "h-[55dvh]",
  large: "h-[calc(100dvh-env(safe-area-inset-top)-0.75rem)]",
};

/** Share of the sheet's height, or a flick, that dismisses it. */
const DISMISS_FRACTION = 0.3;
const DISMISS_VELOCITY = 0.5; // px per ms
const EXPAND_DISTANCE = 60;

/**
 * A bottom dialog on phones (rounded top, slides up, drag down to dismiss)
 * and a centred modal card on desktop. Content sits on the paper colour so
 * `Section` cards stay visible. A native modal `<dialog>`:
 * the page behind is inert, Esc closes it, focus returns to the opener.
 * Never `confirm()`.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  detent,
  closeLabel,
}: SheetProps) {
  const { ref, requestClose } = useModalDialog(open, onClose);
  const [current, setCurrent] = useState<SheetDetent | undefined>(detent);
  const [prevOpen, setPrevOpen] = useState(open);
  const titleId = useId();
  const descriptionId = useId();
  const drag = useRef<{ startY: number; startTime: number; offset: number } | null>(
    null,
  );

  // Every opening starts at the requested detent again.
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setCurrent(detent);
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // Touch and pen only, and only where the sheet is a sheet (not the card).
    if (
      event.pointerType === "mouse" ||
      window.matchMedia("(min-width: 48rem)").matches
    ) {
      return;
    }
    // Capturing the pointer would steal the close button's click.
    if (event.target instanceof Element && event.target.closest("button, a")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startY: event.clientY, startTime: performance.now(), offset: 0 };
    ref.current?.style.setProperty("transition", "none");
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const dialog = ref.current;
    if (!drag.current || !dialog) return;
    const raw = event.clientY - drag.current.startY;
    // Upward: a little give (rubber band), downward: follows the finger.
    const offset = raw < 0 ? raw / 4 : raw;
    drag.current.offset = raw;
    dialog.style.transform = `translateY(${offset}px)`;
  };

  const onPointerUp = () => {
    const dialog = ref.current;
    const state = drag.current;
    drag.current = null;
    if (!dialog || !state) return;
    const elapsed = Math.max(1, performance.now() - state.startTime);
    const velocity = state.offset / elapsed;
    const height = dialog.getBoundingClientRect().height;
    dialog.style.removeProperty("transition");

    if (
      state.offset > height * DISMISS_FRACTION ||
      (velocity > DISMISS_VELOCITY && state.offset > 24)
    ) {
      // Slide out from where the finger let go.
      dialog.style.setProperty("--sheet-drag", `translateY(${state.offset}px)`);
      dialog.style.removeProperty("transform");
      requestClose();
      return;
    }
    if (state.offset < -EXPAND_DISTANCE && current === "medium") setCurrent("large");
    dialog.style.removeProperty("transform");
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      // The dialog box is filled by its content, so only a backdrop tap targets it.
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
      className={cx(
        // Phone: a sheet from the bottom edge.
        "m-0 mt-auto flex w-full max-w-none flex-col overflow-visible rounded-t-sheet border-0 bg-paper p-0 text-ink",
        "transition-[height,transform] duration-300 ease-spring",
        HEIGHT[current ?? "fit"],
        "not-open:hidden data-closing:animate-sheet-out open:motion-safe:animate-sheet-in",
        "backdrop:bg-black/40 open:backdrop:animate-fade-in data-closing:backdrop:animate-fade-out",
        // The surface continues below the bottom edge, so a drag up shows no gap.
        "after:absolute after:inset-x-0 after:top-full after:h-[50vh] after:bg-paper md:after:hidden",
        // Desktop: a centred card.
        "md:m-auto md:h-fit md:max-h-[85dvh] md:w-[min(34rem,calc(100%-3rem))] md:rounded-alert",
        "md:data-closing:animate-fade-out md:open:motion-safe:animate-alert-in",
      )}
    >
      <div
        className="shrink-0 touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div aria-hidden="true" className="flex justify-center pt-1.5 md:hidden">
          <span className="h-1 w-10 rounded-full bg-line" />
        </div>
        <div className="flex min-h-16 items-center justify-between gap-3 px-gutter pt-1 md:px-8 md:pt-4">
          <h2 id={titleId} className="min-w-0 text-title-3 break-words">
            {title}
          </h2>
          <button
            type="button"
            onClick={requestClose}
            className="focus-ring min-h-touch-target shrink-0 pressable rounded-control border-[1.5px] border-line bg-card px-4 text-body font-bold text-ink"
          >
            {closeLabel ?? t("common.close")}
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-gutter pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-8 md:pb-8">
        {description ? (
          <div id={descriptionId} className="text-body text-ink-2">
            {description}
          </div>
        ) : null}
        {children}
      </div>
    </dialog>
  );
}
