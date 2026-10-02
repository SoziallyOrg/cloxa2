"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { ClockInput } from "@cloxa/db";
import type { WorkLocation } from "@cloxa/domain";
import { t } from "@cloxa/i18n";

import { clockAction, syncOfflineClockAction } from "@/app/app/actions";
import { mapClockError, type ClockErrorKey } from "@/lib/clock/errors";
import { staleMessage, messageFor, type OfflineMessage } from "@/lib/offline/outcome";
import type { QueueEntry, SyncReport } from "@/lib/offline/queue";
import { useOfflineQueue } from "@/lib/offline/use-offline-queue";

import type { ClockActionResult } from "./ClockActions";

const TICK_MS = 30_000;

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}
const isOnline = () => navigator.onLine;
// The server can't know (Node even has a `navigator` whose `onLine` is
// undefined), so it renders online; the client corrects after hydration.
const assumeOnline = () => true;

const sendQueued = (entry: QueueEntry) =>
  syncOfflineClockAction({
    type: entry.type,
    idempotencyKey: entry.idempotencyKey,
    siteId: entry.siteId,
    capturedAt: entry.capturedAt,
    ...(entry.workLocation ? { workLocation: entry.workLocation } : {}),
  });

/**
 * The clock actions of the Klok screen and of the clock bar: one place for
 * the live 30s tick, the offline queue and the idempotency keys. The key for
 * each action kind is minted on first press and reused on retry (and for the
 * queued copy), so a flaky network never double-clocks someone.
 */
export function useClockRunner({
  employeeId,
  siteId,
  initialNow,
}: {
  employeeId: string;
  siteId: string;
  /** The server's "now" when it rendered, so the first client render matches it. */
  initialNow: number;
}) {
  const [now, setNow] = useState(initialNow);
  const online = useSyncExternalStore(subscribeOnline, isOnline, assumeOnline);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly OfflineMessage[]>([]);
  const keysRef = useRef<Partial<Record<ClockInput["type"], string>>>({});

  const onReport = useCallback((report: SyncReport) => {
    const next = [
      ...report.dropped.map(staleMessage),
      ...report.settled
        .map(({ entry, result }) => messageFor(entry, result))
        .filter((message): message is OfflineMessage => message !== null),
    ];
    if (next.length > 0) setMessages((current) => [...current, ...next]);
  }, []);

  const queue = useOfflineQueue(employeeId, sendQueued, onReport);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const run = useCallback(
    async (
      type: ClockInput["type"],
      workLocation?: WorkLocation,
    ): Promise<ClockActionResult> => {
      // The press itself is the fact; the queue sends this time later.
      const capturedAt = new Date().toISOString();
      const key = keysRef.current[type] ?? crypto.randomUUID();
      keysRef.current[type] = key;

      const keepOnDevice = async (): Promise<ClockActionResult> => {
        const stored = await queue.enqueue({
          type,
          idempotencyKey: key,
          siteId,
          capturedAt,
          ...(workLocation ? { workLocation } : {}),
        });
        if (!stored) {
          setError(t("offline.saveFailed"));
          return false;
        }
        delete keysRef.current[type];
        setError(null);
        if (navigator.onLine) void queue.sync();
        return "queued";
      };

      if (!online && !queue.supported) {
        // Only a race between the offline event and a click: the buttons
        // are disabled in this case.
        setError(t("clockErrors.network"));
        return false;
      }
      // Earlier actions still queued go first, so this one waits behind them.
      if (queue.supported && (!online || queue.pending.length > 0)) {
        return keepOnDevice();
      }

      let errorKey: ClockErrorKey;
      try {
        const result = await clockAction({
          type,
          idempotencyKey: key,
          siteId,
          ...(workLocation ? { workLocation } : {}),
        });
        if (result.ok) {
          delete keysRef.current[type];
          setError(null);
          return true;
        }
        errorKey = result.errorKey ?? "clockErrors.generic";
      } catch (caught) {
        errorKey = mapClockError(caught);
      }

      // Same key: if the live call did land after all, the sync replays it.
      if (errorKey === "clockErrors.network" && queue.supported) return keepOnDevice();
      setError(t(errorKey));
      return false;
    },
    [online, queue, siteId],
  );

  return { now, online, queue, error, setError, messages, setMessages, run };
}
