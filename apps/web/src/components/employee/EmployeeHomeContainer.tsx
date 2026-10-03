"use client";

import { useCallback, useState } from "react";

import type { Shift, ShiftState, WorkLocation } from "@cloxa/domain";
import { t } from "@cloxa/i18n";

import { displayedState } from "@/lib/offline/queue";

import { ActionSheet } from "../ui/ActionSheet";
import { Notice } from "../ui/Notice";
import { StatusLine } from "../ui/StatusLine";
import { OfflineBanner } from "../clock/OfflineBanner";
import type { ClockActionResult } from "../clock/ClockActions";
import { useClockRunner } from "../clock/use-clock-runner";
import type { PlannedDay } from "../clock/clock-face";
import { EmployeeHome, type LatestEvent, type WeekFacts } from "./EmployeeHome";

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
  /** The site's name, only when the person has more than one. */
  siteName?: string | null;
  week?: WeekFacts | null;
  latest?: readonly LatestEvent[];
  /** The employee's site to clock at, once chosen (`SitePicker` handles `null`). */
  siteId: string;
  /**
   * Telework is on (ADR 008): "Start werk" first asks "Waar werk je vandaag?",
   * with the last answer on this device as the preferred choice.
   */
  askWorkLocation?: boolean;
}

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
 * Owns everything `/app`'s server component can't: the offline banner and
 * the clock buttons, on top of `useClockRunner` (tick, queue, idempotency
 * keys), which the clock bar shares.
 */
export function EmployeeHomeContainer({
  employeeId,
  initialShiftState,
  initialSince,
  initialNow,
  todayShifts,
  planned = null,
  siteName = null,
  week = null,
  latest = [],
  siteId,
  askWorkLocation = false,
}: EmployeeHomeContainerProps) {
  const { now, online, queue, error, setError, messages, setMessages, run } =
    useClockRunner({ employeeId, siteId, initialNow });
  const [asking, setAsking] = useState(false);
  const [preferred, setPreferred] = useState<WorkLocation>("site");
  // Who is waiting for the answer: the pending "Start werk" press.
  const [waiting, setWaiting] = useState<{
    resolve: (location: WorkLocation | null) => void;
  } | null>(null);

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
        siteName={siteName}
        week={week}
        latest={latest}
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
