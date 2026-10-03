"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { supportsOfflineQueue } from "./browser";
import {
  indexedDbQueueStorage,
  pendingFor,
  syncQueue,
  type QueueEntry,
  type QueueStorage,
  type SyncOutcome,
  type SyncReport,
} from "./queue";

const SYNC_INTERVAL_MS = 60_000;

const noSubscription = () => () => {};
// The server cannot know; the client corrects after hydration.
const unsupportedOnServer = () => false;

export interface OfflineQueue {
  /** IndexedDB and service workers are there: actions can be queued. */
  supported: boolean;
  /** This employee's queued actions, oldest first. */
  pending: readonly QueueEntry[];
  /** False when the entry could not be stored (the caller shows an error). */
  enqueue(entry: Omit<QueueEntry, "employeeId" | "attempts">): Promise<boolean>;
  sync(): Promise<void>;
}

/**
 * The employee's offline queue: syncs when the app opens, when the browser
 * comes back online and every 60 s while something is pending. One run at a
 * time; the server is idempotent per key, so a run racing another tab is
 * harmless.
 */
export function useOfflineQueue(
  employeeId: string,
  send: (entry: QueueEntry) => Promise<SyncOutcome>,
  onReport: (report: SyncReport) => void,
): OfflineQueue {
  const supported = useSyncExternalStore(
    noSubscription,
    supportsOfflineQueue,
    unsupportedOnServer,
  );
  const [pending, setPending] = useState<readonly QueueEntry[]>([]);
  const storageRef = useRef<QueueStorage | null>(null);
  const syncingRef = useRef(false);
  const sendRef = useRef(send);
  const reportRef = useRef(onReport);
  useEffect(() => {
    sendRef.current = send;
    reportRef.current = onReport;
  });

  const storage = useCallback((): QueueStorage | null => {
    if (!supported) return null;
    storageRef.current ??= indexedDbQueueStorage();
    return storageRef.current;
  }, [supported]);

  const reload = useCallback(async () => {
    const store = storage();
    if (!store) return;
    try {
      setPending(pendingFor(await store.list(), employeeId));
    } catch {
      // IndexedDB unavailable right now; the next reload tries again.
    }
  }, [storage, employeeId]);

  /** Sends what is pending (when online and not already running), then re-reads the queue. */
  const sync = useCallback(async () => {
    const store = storage();
    if (!store) return;
    if (!syncingRef.current && navigator.onLine) {
      syncingRef.current = true;
      try {
        const report = await syncQueue(store, employeeId, (entry) =>
          sendRef.current(entry),
        );
        reportRef.current(report);
      } catch {
        // Storage failed mid-run: whatever is left stays queued.
      } finally {
        syncingRef.current = false;
      }
    }
    await reload();
  }, [storage, employeeId, reload]);

  const enqueue = useCallback<OfflineQueue["enqueue"]>(
    async (entry) => {
      const store = storage();
      if (!store) return false;
      try {
        await store.add({ ...entry, employeeId, attempts: 0 });
      } catch {
        return false;
      }
      await reload();
      return true;
    },
    [storage, employeeId, reload],
  );

  useEffect(() => {
    if (!supported) return;
    const onOnline = () => void sync();
    // App open: shows what is still queued and sends it when possible. From
    // a task, not the effect body: the queue is an external store read async.
    const opened = window.setTimeout(onOnline, 0);
    window.addEventListener("online", onOnline);
    return () => {
      window.clearTimeout(opened);
      window.removeEventListener("online", onOnline);
    };
  }, [supported, reload, sync]);

  const hasPending = pending.length > 0;
  useEffect(() => {
    if (!hasPending) return;
    const id = window.setInterval(() => void sync(), SYNC_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [hasPending, sync]);

  return { supported, pending, enqueue, sync };
}
