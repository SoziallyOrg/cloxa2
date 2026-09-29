"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { ClockInput } from "@cloxa/db";
import type { Shift, ShiftState, WorkLocation } from "@cloxa/domain";
import { t } from "@cloxa/i18n";

import { clockAction, syncOfflineClockAction } from "@/app/app/actions";
import { mapClockError, type ClockErrorKey } from "@/lib/clock/errors";
import { messageFor, staleMessage, type OfflineMessage } from "@/lib/offline/outcome";
import { displayedState, type QueueEntry, type SyncReport } from "@/lib/offline/queue";
import { useOfflineQueue } from "@/lib/offline/use-offline-queue";

import { ActionSheet } from "../ui/ActionSheet";
import { Notice } from "../ui/Notice";
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
  /**
   * Telework is on (ADR 008): "Start werk" first asks "Waar werk je vandaag?",
   * with the last answer on this device as the preferred choice.
   */
  askWorkLocation?: boolean;
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
    ...(entry.workLocation ? { workLocation: entry.workLocation } : {}),
  });

const LOCATION_KEY = "cloxa.workLocation";

/** The last answer on this device, per employee (a shared phone keeps them apart). */
function rememberedLocation(employeeId: string): WorkLocation {
  try {
    return window.localStorage.getItem(`${LOCATION_KEY}.${employeeId}`) === "home"
      ? "home"
      : "site";
  } catch {
    return "site";
  }
}

function rememberLocation(employeeId: string, location: WorkLocation): void {
  try {
    window.localStorage.setItem(`${LOCATION_KEY}.${employeeId}`, location);
  } catch {
    // Private mode or storage full: the question just starts at "Op de werkplek".
  }
}

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
  askWorkLocation = false,
}: EmployeeHomeContainerProps) {
  const [now, setNow] = useState(initialNow);
  const online = useSyncExternalStore(subscribeOnline, isOnline, assumeOnline);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly OfflineMessage[]>([]);
  const keysRef = useRef<Partial<Record<ClockInput["type"], string>>>({});
  const [asking, setAsking] = useState(false);
  const [preferred, setPreferred] = useState<WorkLocation>("site");
  // Who is waiting for the answer: the pending "Start werk" press.
  const [waiting, setWaiting] = useState<{
    resolve: (location: WorkLocation | null) => void;
  } | null>(null);

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

  /** Resolves with the answer, or null when the sheet is closed without one. */
  const askLocation = useCallback((): Promise<WorkLocation | null> => {
    setPreferred(rememberedLocation(employeeId));
    setAsking(true);
    return new Promise((resolve) => setWaiting({ resolve }));
  }, [employeeId]);

  function answer(location: WorkLocation | null) {
    setWaiting(null);
    waiting?.resolve(location);
  }

  const startWork = useCallback(async (): Promise<ClockActionResult> => {
    if (!askWorkLocation) return run("clock_in");
    const location = await askLocation();
    if (location === null) return "cancelled";
    rememberLocation(employeeId, location);
    return run("clock_in", location);
  }, [askLocation, askWorkLocation, employeeId, run]);

  const locationChoices = [
    {
      key: "site",
      label: t("modules.telework.askSite"),
      onSelect: () => answer("site"),
      preferred: preferred === "site",
    },
    {
      key: "home",
      label: t("modules.telework.askHome"),
      onSelect: () => answer("home"),
      preferred: preferred === "home",
    },
  ];

  const displayed = displayedState(
    { state: initialShiftState, since: initialSince },
    queue.pending,
  );

  return (
    <>
      <EmployeeHome
        shiftState={displayed.state}
        since={displayed.since}
        // A refresh brings a newer server "now"; never show time before it.
        now={Math.max(now, initialNow)}
        todayShifts={todayShifts}
        pending={queue.pending}
        planned={planned}
        actionsDisabled={!online && !queue.supported}
        onStartWork={startWork}
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
                <Notice
                  key={`${message.key}-${index}`}
                  tone={message.tone}
                  onDismiss={() =>
                    setMessages((current) => current.filter((_, i) => i !== index))
                  }
                >
                  {t(message.key, message.values)}
                </Notice>
              ))}
            </>
          ) : null
        }
        error={
          error ? (
            <Notice tone="error" onDismiss={() => setError(null)}>
              {error}
            </Notice>
          ) : null
        }
      />
      {askWorkLocation ? (
        <ActionSheet
          open={asking}
          onClose={() => {
            setAsking(false);
            answer(null);
          }}
          title={t("modules.telework.askTitle")}
          // The last answer first, in bold: one tap on a normal day.
          actions={
            preferred === "home" ? [...locationChoices].reverse() : locationChoices
          }
        />
      ) : null}
    </>
  );
}
