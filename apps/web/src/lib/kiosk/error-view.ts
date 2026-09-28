/**
 * Kiosk refusals as copy keys, for the tablet screen. Pure (no `t()`) and
 * without `@cloxa/db`, so the client bundle stays small. The database answers
 * anonymous callers with a few uniform codes only, so nothing here can tell
 * whether an employee exists.
 */
import type { CatalogKey } from "@cloxa/i18n";

/** Only show "n tries left" once it matters. */
export const SHOW_TRIES_LEFT_AT = 2;

export interface KioskErrorView {
  readonly key: CatalogKey;
  readonly values?: Readonly<Record<string, number>>;
  /** The tablet is not (or no longer) paired: show the pairing screen. */
  readonly unpaired: boolean;
  /** The PIN must be typed again (wrong, or locked out). */
  readonly pinAgain: boolean;
}

export function kioskErrorView(
  code: string,
  triesLeft: number | null = null,
): KioskErrorView {
  switch (code) {
    case "pin_invalid":
      return triesLeft !== null && triesLeft <= SHOW_TRIES_LEFT_AT
        ? {
            key: "kiosk.errorPinTriesLeft",
            values: { count: triesLeft },
            unpaired: false,
            pinAgain: true,
          }
        : { key: "kiosk.errorPin", unpaired: false, pinAgain: true };
    case "pin_locked":
      return { key: "kiosk.errorLocked", unpaired: false, pinAgain: true };
    case "device_paused":
      return { key: "kiosk.errorPaused", unpaired: false, pinAgain: true };
    case "device_unknown":
      return { key: "kiosk.errorUnpaired", unpaired: true, pinAgain: false };
    case "invalid_transition":
      return { key: "kiosk.errorTransition", unpaired: false, pinAgain: false };
    case "network":
      return { key: "kiosk.errorNetwork", unpaired: false, pinAgain: false };
    default:
      return { key: "kiosk.errorGeneric", unpaired: false, pinAgain: false };
  }
}
