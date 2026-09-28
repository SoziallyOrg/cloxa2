"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { formatBrusselsTime, t, type CatalogKey } from "@cloxa/i18n";

import {
  kioskClockAction,
  kioskStatusAction,
  type KioskActionResult,
} from "@/app/kiosk/actions";
import { kioskErrorView, type KioskErrorView } from "@/lib/kiosk/error-view";
import {
  firstName,
  IDLE_PHASE,
  kioskReducer,
  returnDelayMs,
  type KioskClockType,
  type KioskPerson,
} from "@/lib/kiosk/machine";

import { ClockActions } from "../clock/ClockActions";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { IconCheck } from "../ui/icons";
import { KioskHome, type KioskEmployee } from "./KioskHome";

export interface KioskScreenProps {
  employees: readonly (KioskEmployee & { hasPin: boolean })[];
}

const DONE_KEY: Record<KioskClockType, CatalogKey> = {
  clock_in: "kiosk.doneClockIn",
  clock_out: "kiosk.doneClockOut",
  break_start: "kiosk.doneBreakStart",
  break_end: "kiosk.doneBreakEnd",
};

/** New names and a lifted pause show up without anyone touching the tablet. */
const IDLE_REFRESH_MS = 5 * 60_000;

function errorText(view: KioskErrorView): string {
  return t(view.key, view.values);
}

/**
 * The shared tablet: name tiles, PIN pad, the right big action, then a short
 * confirmation. Returns to the tiles 5 seconds after a confirmation and 30
 * seconds after the last touch anywhere else. Never shows hours.
 */
export function KioskScreen({ employees }: KioskScreenProps) {
  const router = useRouter();
  const [phase, dispatch] = useReducer(kioskReducer, IDLE_PHASE);
  const [touches, setTouches] = useState(0);
  // One idempotency key per (employee, action) until it succeeds, so a retry
  // after a network error never records the event twice.
  const pendingKey = useRef<{
    employeeId: string;
    type: KioskClockType;
    key: string;
  } | null>(null);

  useEffect(() => {
    const touched = () => setTouches((count) => count + 1);
    window.addEventListener("pointerdown", touched);
    window.addEventListener("keydown", touched);
    return () => {
      window.removeEventListener("pointerdown", touched);
      window.removeEventListener("keydown", touched);
    };
  }, []);

  // A touch restarts the inactivity timer, but never extends the confirmation.
  const timerReset = phase.kind === "done" ? 0 : touches;
  useEffect(() => {
    const delay = returnDelayMs(phase);
    if (delay === null) return;
    const id = window.setTimeout(() => dispatch({ type: "timeout" }), delay);
    return () => window.clearTimeout(id);
  }, [phase, timerReset]);

  useEffect(() => {
    if (phase.kind !== "idle") return;
    const id = window.setInterval(() => router.refresh(), IDLE_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [phase.kind, router]);

  const fail = useCallback(
    (result: Extract<KioskActionResult, { ok: false }>) => {
      const view = kioskErrorView(result.error, result.triesLeft);
      dispatch({ type: "failed", error: view });
      // The action already forgot the secret; the page shows the pairing screen.
      if (view.unpaired) router.refresh();
    },
    [router],
  );

  async function submitPin(employeeId: string, pin: string) {
    dispatch({ type: "submitPin" });
    let result: KioskActionResult;
    try {
      result = await kioskStatusAction({ employeeId, pin });
    } catch {
      result = {
        ok: false,
        error: "network",
        triesLeft: null,
        retryAfterSeconds: null,
      };
    }
    if (result.ok) dispatch({ type: "statusOk", pin, state: result.state });
    else fail(result);
  }

  async function clock(type: KioskClockType): Promise<boolean> {
    if (phase.kind !== "action") return false;
    const employeeId = phase.person.id;
    const previous = pendingKey.current;
    const key =
      previous?.employeeId === employeeId && previous.type === type
        ? previous.key
        : crypto.randomUUID();
    pendingKey.current = { employeeId, type, key };

    dispatch({ type: "submitAction" });
    let result: KioskActionResult;
    try {
      result = await kioskClockAction({
        employeeId,
        pin: phase.pin,
        type,
        idempotencyKey: key,
      });
    } catch {
      result = {
        ok: false,
        error: "network",
        triesLeft: null,
        retryAfterSeconds: null,
      };
    }
    if (!result.ok) {
      fail(result);
      return false;
    }
    pendingKey.current = null;
    const at = result.occurredAt === null ? new Date() : new Date(result.occurredAt);
    dispatch({ type: "clockOk", clockType: type, time: formatBrusselsTime(at) });
    return true;
  }

  if (phase.kind === "done") {
    return (
      <div
        role="status"
        className="mx-auto flex min-h-screen w-full max-w-lg flex-col items-center justify-center gap-6 p-6 text-center"
      >
        <IconCheck className="size-24 text-status-working" />
        <p className="text-3xl font-bold">
          {t(DONE_KEY[phase.clockType], {
            time: phase.time,
            name: firstName(phase.person.name),
          })}
        </p>
        <Button
          variant="secondary"
          size="lg"
          onClick={() => dispatch({ type: "back" })}
        >
          {t("kiosk.doneBack")}
        </Button>
      </div>
    );
  }

  if (phase.kind === "action") {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-8 p-6">
        <h1 className="text-center text-3xl font-bold">
          {t("kiosk.actionTitle", { name: firstName(phase.person.name) })}
        </h1>
        {phase.error ? <Alert tone="error">{errorText(phase.error)}</Alert> : null}
        <ClockActions
          state={phase.state}
          disabled={phase.busy}
          onStartWork={() => clock("clock_in")}
          onStopWork={() => clock("clock_out")}
          onStartBreak={() => clock("break_start")}
          onStopBreak={() => clock("break_end")}
        />
        <Button variant="quiet" size="lg" onClick={() => dispatch({ type: "back" })}>
          {t("kiosk.pinBack")}
        </Button>
      </div>
    );
  }

  const selected: KioskPerson | null = phase.kind === "pin" ? phase.person : null;

  return (
    <KioskHome
      employees={employees}
      selected={selected}
      onSelect={(employee) =>
        employee === null
          ? dispatch({ type: "back" })
          : dispatch({
              type: "select",
              person: {
                id: employee.id,
                name: employee.name,
                hasPin: employee.hasPin !== false,
              },
            })
      }
      onSubmitPin={submitPin}
      busy={phase.kind === "pin" && phase.busy}
      error={phase.kind === "pin" && phase.error ? errorText(phase.error) : null}
    />
  );
}
