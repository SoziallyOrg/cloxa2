/**
 * Light haptics through `navigator.vibrate` where the browser has it
 * (Android). A silent no-op everywhere else, including iOS Safari, so
 * callers never need to check.
 */
function vibrate(pattern: number | number[]): boolean {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return false;
  }
  try {
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}

/** A light tap: clock actions, toggles, a completed pull-to-refresh. */
export function tap(): boolean {
  return vibrate(10);
}

/** A double tap: something went wrong. */
export function error(): boolean {
  return vibrate([20, 60, 20]);
}
