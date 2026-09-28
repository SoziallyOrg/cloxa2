/**
 * Browser-only glue for offline clocking: feature detection, the service
 * worker registration and the shell cache cleanup. Call from effects only.
 */

import { indexedDbQueueStorage, pendingFor } from "./queue";

/** Must match `CACHE` in `public/sw.js`. */
export const SHELL_CACHE = "cloxa-shell-v1";

/**
 * Queueing needs IndexedDB (the queue) and service workers (so the clock
 * screen still opens offline). Without either, the old "clocking is not
 * possible offline" behaviour stays.
 */
export function supportsOfflineQueue(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.indexedDB !== "undefined" &&
    "serviceWorker" in navigator &&
    window.isSecureContext
  );
}

/** Scoped to /app: the worker never sees /manage, /kiosk or /login. */
export async function registerShellWorker(): Promise<void> {
  if (!supportsOfflineQueue()) return;
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/app" });
  } catch {
    // Offline shell unavailable (e.g. private mode); clocking still works online.
  }
}

/** After sign-out: the next person on a shared phone must not see the old screen. */
export async function clearShellCache(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    await caches.delete(SHELL_CACHE);
  } catch {
    // Nothing cached, or storage blocked: nothing to clear.
  }
}

/**
 * How many clock actions of this employee are still queued on this device,
 * for the sign-out warning on screens that don't run the queue themselves.
 */
export async function queuedCountFor(employeeId: string): Promise<number> {
  if (!supportsOfflineQueue()) return 0;
  try {
    const storage = indexedDbQueueStorage();
    return storage ? pendingFor(await storage.list(), employeeId).length : 0;
  } catch {
    return 0;
  }
}
