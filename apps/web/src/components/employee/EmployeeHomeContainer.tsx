"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { ClockInput } from "@cloxa/db";
import type { Shift, ShiftState } from "@cloxa/domain";
import { t } from "@cloxa/i18n";

import { clockAction, syncOfflineClockAction } from "@/app/app/actions";
import { mapClockError, type ClockErrorKey } from "@/lib/clock/errors";
import { messageFor, staleMessage, type OfflineMessage } from "@/lib/offline/outcome";
import { displayedState, type QueueEntry, type SyncReport } from "@/lib/offline/queue";
import { useOfflineQueue } from "@/lib/offline/use-offline-queue";

import { Alert } from "../ui/Alert";
import { StatusLine } from "../ui/StatusLine";
import { OfflineBanner } from "../clock/OfflineBanner";
import type { ClockActionResult } from "../clock/ClockActions";
import type { PlannedDay } from "../clock/clock-face";
import { EmployeeHome } from "./EmployeeHome";

export interface EmployeeHomeContainerProps {
  /** The signed-in employee: queued actions are kept per employee. */
  employeeId: string;
  initialShiftState: ShiftState;
  initialSince: number | null;
  /** The server's "now" when it rendered, so the first client render matches it. */
  initialNow: number;
  todayShifts: readonly Shift[];
  /** Today's schedule, or `null` when nothing is planned. */
  planned?: PlannedDay | null;
  /** The employee's site to clock at, once chosen (`SitePicker` handles `null`). */
  siteId: string;
}

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
  });

/**
 * Owns everything `/app`'s server component can't: the live 30s tick, the
 * offline banner and queue, and the clock buttons themselves. The idempotency
 * key for each action kind is minted here on first press and reused on retry
 * (and for the queued copy), so a flaky network never double-clocks someone.
 */
export function EmployeeHomeContainer({
  employeeId,
  initialShiftState,
  initialSince,
  initialNow,
  todayShifts,
  planned = null,
  siteId,
}: EmployeeHomeContainerProps) {
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
    async (type: ClockInput["type"]): Promise<ClockActionResult> => {
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
        const result = await clockAction({ type, idempotencyKey: key, siteId });
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

  const displayed = displayedState(
    { state: initialShiftState, since: initialSince },
    queue.pending,
  );

  return (
    <EmployeeHome
      shiftState={displayed.state}
      since={displayed.since}
      // A refresh brings a newer server "now"; never show time before it.
      now={Math.max(now, initialNow)}
      todayShifts={todayShifts}
      pending={queue.pending}
      planned={planned}
      actionsDisabled={!online && !queue.supported}
      onStartWork={() => run("clock_in")}
      onStopWork={() => run("clock_out")}
      onStartBreak={() => run("break_start")}
      onStopBreak={() => run("break_end")}
      notice={
        !online || queue.pending.length > 0 || messages.length > 0 ? (
          <>
            {!online ? <OfflineBanner queueing={queue.supported} /> : null}
            {queue.pending.length > 0 ? (
              <div>
                <StatusLine tone="attention" label={t("offline.notSent")} size="sm" />
              </div>
            ) : null}
            {messages.map((message, index) => (
              <Alert
                key={`${message.key}-${index}`}
                tone={message.tone}
                onDismiss={() =>
                  setMessages((current) => current.filter((_, i) => i !== index))
                }
              >
                {t(message.key, message.values)}
              </Alert>
            ))}
          </>
        ) : null
      }
      error={
        error ? (
          <Alert tone="error" onDismiss={() => setError(null)}>
            {error}
          </Alert>
        ) : null
      }
    />
  );
}
