"use client";

import { useCallback, useEffect, useRef } from "react";

/** Longest exit animation (sheet-out); a safety net if `animationend` never fires. */
const EXIT_FALLBACK_MS = 400;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Drives a native modal `<dialog>` from an `open` prop, for `Sheet`,
 * `ActionSheet` and `Alert`:
 *
 * - `showModal()` makes the page behind inert, so focus stays inside.
 * - Closing (Esc, the backdrop, a button, a drag, or `open` turning false)
 *   first plays the exit animation (`data-closing`), then closes.
 * - Focus goes back to whatever opened the dialog.
 * - `onClose` runs once the dialog has actually closed.
 */
export function useModalDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const closing = useRef(false);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const requestClose = useCallback(() => {
    const dialog = ref.current;
    if (!dialog?.open || closing.current) return;
    if (prefersReducedMotion()) {
      dialog.close();
      return;
    }
    closing.current = true;
    dialog.dataset["closing"] = "";
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      dialog.removeEventListener("animationend", onEnd);
      dialog.close();
    };
    const onEnd = (event: AnimationEvent) => {
      if (event.target === dialog) finish();
    };
    dialog.addEventListener("animationend", onEnd);
    window.setTimeout(finish, EXIT_FALLBACK_MS);
  }, []);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      closing.current = false;
      delete dialog.dataset["closing"];
      dialog.showModal();
    } else if (!open && dialog.open) {
      requestClose();
    }
  }, [open, requestClose]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onCancel = (event: Event) => {
      // Esc: animate out instead of vanishing.
      event.preventDefault();
      requestClose();
    };
    const onClosed = () => {
      closing.current = false;
      delete dialog.dataset["closing"];
      dialog.style.removeProperty("transform");
      dialog.style.removeProperty("--sheet-drag");
      opener.current?.focus({ preventScroll: true });
      opener.current = null;
      onCloseRef.current();
    };
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onClosed);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onClosed);
    };
  }, [requestClose]);

  return { ref, requestClose };
}
