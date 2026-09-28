"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { ClockInput } from "@cloxa/db";
import type { Shift, ShiftState } from "@cloxa/domain";
import { t } from "@cloxa/i18n";

import { clockAction } from "@/app/app/actions";
import { mapClockError } from "@/lib/clock/errors";

import { Alert } from "../ui/Alert";
import { OfflineBanner } from "../clock/OfflineBanner";
import { SessionActions } from "../auth/SessionActions";
import { EmployeeHome, type EmployeeHomeNav } from "./EmployeeHome";

export interface EmployeeHomeContainerProps {
  firstName: string;
  initialShiftState: ShiftState;
  initialSince: number | null;
  /** The server's "now" when it rendered, so the first client render matches it. */
  initialNow: number;
  todayShifts: readonly Shift[];
  plannedToday?: string | null;
  activeNav: EmployeeHomeNav;
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

/**
 * Owns everything `/app`'s server component can't: the live 30s tick, the
 * offline banner, and the clock buttons themselves. The idempotency key for
 * each action kind is minted here on first press and reused on retry, so a
 * flaky network never double-clocks someone.
 */
export function EmployeeHomeContainer({
  firstName,
  initialShiftState,
  initialSince,
  initialNow,
  todayShifts,
  plannedToday = null,
  activeNav,
  siteId,
}: EmployeeHomeContainerProps) {
  const [now, setNow] = useState(initialNow);
  const online = useSyncExternalStore(subscribeOnline, isOnline, assumeOnline);
  const [error, setError] = useState<string | null>(null);
  const keysRef = useRef<Partial<Record<ClockInput["type"], string>>>({});

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const run = useCallback(
    async (type: ClockInput["type"]): Promise<boolean> => {
      if (!online) {
        // TODO: queue this action and replay it once back online, instead
        // of just refusing (the buttons are disabled for this case anyway;
        // this only guards a race between the offline event and a click).
        setError(t("clockErrors.network"));
        return false;
      }

      const key = keysRef.current[type] ?? crypto.randomUUID();
      keysRef.current[type] = key;

      try {
        const result = await clockAction({ type, idempotencyKey: key, siteId });
        if (!result.ok) {
          setError(t(result.errorKey ?? "clockErrors.generic"));
          return false;
        }
      } catch (caught) {
        setError(t(mapClockError(caught)));
        return false;
      }

      delete keysRef.current[type];
      setError(null);
      return true;
    },
    [online, siteId],
  );

  return (
    <EmployeeHome
      firstName={firstName}
      shiftState={initialShiftState}
      since={initialSince}
      // A refresh brings a newer server "now"; never show time before it.
      now={Math.max(now, initialNow)}
      todayShifts={todayShifts}
      plannedToday={plannedToday}
      activeNav={activeNav}
      actionsDisabled={!online}
      onStartWork={() => run("clock_in")}
      onStopWork={() => run("clock_out")}
      onStartBreak={() => run("break_start")}
      onStopBreak={() => run("break_end")}
      menu={<SessionActions everywhere />}
      notice={
        <>
          {!online ? <OfflineBanner /> : null}
          {error ? (
            <Alert tone="error" onDismiss={() => setError(null)}>
              {error}
            </Alert>
          ) : null}
        </>
      }
    />
  );
}
