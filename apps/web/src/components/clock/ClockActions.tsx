"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

import { formatBrusselsTime, t } from "@cloxa/i18n";
import type { ShiftState } from "@cloxa/domain";

import { Button } from "../ui/Button";
import { cx } from "../ui/cx";
import { error as errorHaptic, tap } from "../ui/haptics";

export type ActionKind = "startWork" | "stopWork" | "startBreak" | "stopBreak";

const SUCCESS_KEY: Record<
  ActionKind,
  "startedAt" | "stoppedAt" | "breakStartedAt" | "breakStoppedAt"
> = {
  startWork: "startedAt",
  stopWork: "stoppedAt",
  startBreak: "breakStartedAt",
  stopBreak: "breakStoppedAt",
};

/** The check takes the colour of the state the person is in now. */
const SUCCESS_TONE: Record<ActionKind, string> = {
  startWork: "bg-working/12 text-working",
  stopBreak: "bg-working/12 text-working",
  startBreak: "bg-break/12 text-break",
  stopWork: "bg-fill text-ink",
};

const SUCCESS_DISPLAY_MS = 2000;

/** `true` on success; `"queued"` when kept on the device to send later (offline);
 * `false` leaves the button idle without celebrating (the caller is expected to
 * show its own error). */
export type ClockActionResult = boolean | "queued";
export type ClockActionCallback = () => ClockActionResult | Promise<ClockActionResult>;

export interface ClockActionsProps {
  state: ShiftState;
  onStartWork: ClockActionCallback;
  onStopWork: ClockActionCallback;
  onStartBreak: ClockActionCallback;
  onStopBreak: ClockActionCallback;
  /** Disables every button, e.g. while offline. */
  disabled?: boolean;
  /**
   * Renders the success confirmation immediately, as if `action` had just
   * completed at `time`. For the design preview only — real usage always
   * reaches success through a click.
   */
  previewSuccess?: { action: ActionKind; time: string };
}

interface Success {
  action: ActionKind;
  time: string;
  queued?: boolean;
}

/**
 * The clock action(s) for the current state (the primary action plus
 * Pauze), and the full-screen confirmation after a press: a big check, the
 * time, a short vibration, gone after 2 seconds. Callbacks only — no data
 * fetching, so this stays reusable across the employee app and the kiosk.
 */
export function ClockActions({
  state,
  onStartWork,
  onStopWork,
  onStartBreak,
  onStopBreak,
  disabled = false,
  previewSuccess,
}: ClockActionsProps) {
  const [pending, setPending] = useState<ActionKind | null>(null);
  const [success, setSuccess] = useState<Success | null>(previewSuccess ?? null);

  useEffect(() => {
    if (success === null || previewSuccess) return;

    const timer = window.setTimeout(() => setSuccess(null), SUCCESS_DISPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [success, previewSuccess]);

  async function run(action: ActionKind, callback: ClockActionCallback) {
    // One press at a time: every button waits until this one has settled.
    if (pending !== null) return;
    setPending(action);
    const result = await callback();
    setPending(null);
    if (!result) {
      errorHaptic();
      return;
    }

    setSuccess({
      action,
      time: formatBrusselsTime(new Date()),
      queued: result === "queued",
    });
    tap();
  }

  if (success !== null) {
    return (
      <div
        role="status"
        className={cx(
          "inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-paper px-gutter text-center motion-safe:animate-fade-in",
          previewSuccess ? "relative min-h-96 rounded-group" : "fixed",
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            "flex size-32 items-center justify-center rounded-full motion-safe:animate-pop-in",
            SUCCESS_TONE[success.action],
          )}
        >
          <Check aria-hidden="true" className="size-16" strokeWidth={2.25} />
        </span>
        <p className="text-title-1 font-semibold">
          {t(`actions.${SUCCESS_KEY[success.action]}`, { time: success.time })}
        </p>
        {success.queued ? (
          <p className="max-w-xs text-body text-ink-2">{t("offline.savedOnDevice")}</p>
        ) : null}
      </div>
    );
  }

  const busy = disabled || pending !== null;

  if (state === "off") {
    return (
      <Button
        size="lg"
        loading={pending === "startWork"}
        disabled={busy}
        onClick={() => void run("startWork", onStartWork)}
      >
        {t("actions.startWork")}
      </Button>
    );
  }

  if (state === "working") {
    return (
      <div className="flex flex-col gap-3">
        <Button
          size="lg"
          loading={pending === "stopWork"}
          disabled={busy}
          onClick={() => void run("stopWork", onStopWork)}
        >
          {t("actions.stopWork")}
        </Button>
        <Button
          variant="secondary"
          wide
          loading={pending === "startBreak"}
          disabled={busy}
          onClick={() => void run("startBreak", onStartBreak)}
        >
          {t("actions.startBreak")}
        </Button>
      </div>
    );
  }

  return (
    <Button
      size="lg"
      loading={pending === "stopBreak"}
      disabled={busy}
      onClick={() => void run("stopBreak", onStopBreak)}
    >
      {t("actions.stopBreak")}
    </Button>
  );
}
