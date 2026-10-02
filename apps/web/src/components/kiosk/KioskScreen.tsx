"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

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

import { ClockActions, type ClockSurface } from "../clock/ClockActions";
import { Logo } from "../brand/Logo";
import { cx } from "../ui/cx";
import { Notice } from "../ui/Notice";
import { Button } from "../ui/Button";
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

/** The confirmation is a full colour block, like the status: forest working, amber pause, grey stopped. */
const DONE_TONE: Record<
  KioskClockType,
  { block: string; check: string; button: "action" | "primary" }
> = {
  clock_in: {
    block: "on-forest bg-forest text-white",
    check: "bg-lime text-forest-deep",
    button: "action",
  },
  break_end: {
    block: "on-forest bg-forest text-white",
    check: "bg-lime text-forest-deep",
    button: "action",
  },
  break_start: {
    block: "bg-break text-break-ink",
    check: "bg-forest text-white",
    button: "primary",
  },
  clock_out: {
    block: "bg-idle text-ink",
    check: "bg-forest text-white",
    button: "primary",
  },
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
    const tone = DONE_TONE[phase.clockType];
    return (
      <div
        role="status"
        className={cx(
          "flex min-h-dvh flex-col items-center justify-center gap-8 p-6 text-center",
          tone.block,
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            "flex size-32 items-center justify-center rounded-hero",
            tone.check,
          )}
        >
          <Check className="size-16" strokeWidth={2.5} />
        </span>
        <p className="max-w-2xl text-large-title">
          {t(DONE_KEY[phase.clockType], {
            time: phase.time,
            name: firstName(phase.person.name),
          })}
        </p>
        <div className="w-full max-w-sm">
          <Button
            variant={tone.button}
            size="lg"
            onClick={() => dispatch({ type: "back" })}
          >
            {t("kiosk.doneBack")}
          </Button>
        </div>
      </div>
    );
  }

  if (phase.kind === "action") {
    // The block takes the person's current status colour; the words say it too.
    const surface: ClockSurface =
      phase.state === "working"
        ? "forest"
        : phase.state === "on_break"
          ? "amber"
          : "light";
    return (
      <div
        className={cx(
          "flex min-h-dvh flex-col",
          surface === "forest"
            ? "on-forest bg-forest text-white"
            : surface === "amber"
              ? "bg-break text-break-ink"
              : "bg-paper text-ink",
        )}
      >
        <div className="px-8 pt-6">
          <Logo size="lg" tone={surface === "forest" ? "on-forest" : "on-light"} />
        </div>
        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-6 p-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-large-title">
              {t("kiosk.actionTitle", { name: firstName(phase.person.name) })}
            </h1>
            <p className="text-title-3">
              {phase.state === "working"
                ? t("kiosk.stateWorking")
                : phase.state === "on_break"
                  ? t("kiosk.stateBreak")
                  : t("kiosk.stateOff")}
            </p>
          </div>
          {phase.error ? <Notice tone="error">{errorText(phase.error)}</Notice> : null}
          <ClockActions
            state={phase.state}
            surface={surface}
            disabled={phase.busy}
            onStartWork={() => clock("clock_in")}
            onStopWork={() => clock("clock_out")}
            onStartBreak={() => clock("break_start")}
            onStopBreak={() => clock("break_end")}
          />
          <Button
            variant={surface === "forest" ? "ghost-on-forest" : "plain"}
            size="md"
            onClick={() => dispatch({ type: "back" })}
          >
            {t("kiosk.pinBack")}
          </Button>
        </div>
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
