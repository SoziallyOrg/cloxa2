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

/**
 * The confirmation is a full colour block, like the status itself: forest when
 * working, amber on pause, grey when done. The words always say it too.
 */
const SUCCESS_BLOCK: Record<ActionKind, { block: string; check: string }> = {
  startWork: {
    block: "on-forest bg-forest text-white",
    check: "bg-lime text-forest-deep",
  },
  stopBreak: {
    block: "on-forest bg-forest text-white",
    check: "bg-lime text-forest-deep",
  },
  startBreak: { block: "bg-break text-break-ink", check: "bg-forest text-white" },
  stopWork: { block: "bg-idle text-ink", check: "bg-forest text-white" },
};

const SUCCESS_DISPLAY_MS = 2000;

/** `true` on success; `"queued"` when kept on the device to send later (offline);
 * `false` leaves the button idle without celebrating (the caller is expected to
 * show its own error); `"cancelled"` when the person backed out of a question
 * (nothing happened, so no error either). */
export type ClockActionResult = boolean | "queued" | "cancelled";
export type ClockActionCallback = () => ClockActionResult | Promise<ClockActionResult>;

/** The colour of the block the buttons sit on: it decides which variants read well. */
export type ClockSurface = "light" | "forest" | "amber";

export interface ClockActionsProps {
  state: ShiftState;
  /** `forest` (Klok working, kiosk): lime main action, glass secondary. `amber` (on pause) and `light`: forest main action. */
  surface?: ClockSurface;
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
  surface = "light",
  onStartWork,
  onStopWork,
  onStartBreak,
  onStopBreak,
  disabled = false,
  previewSuccess,
}: ClockActionsProps) {
  const mainVariant = surface === "forest" ? "action" : "primary";
  const sideVariant = surface === "forest" ? "ghost-on-forest" : "secondary";
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
    if (result === "cancelled") return;
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
          "inset-0 z-50 flex flex-col items-center justify-center gap-6 px-gutter text-center motion-safe:animate-fade-in",
          SUCCESS_BLOCK[success.action].block,
          previewSuccess ? "relative min-h-96 rounded-hero" : "fixed",
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            "flex size-32 items-center justify-center rounded-full motion-safe:animate-pop-in",
            SUCCESS_BLOCK[success.action].check,
          )}
        >
          <Check aria-hidden="true" className="size-16" strokeWidth={2.25} />
        </span>
        <p className="text-title-1">
          {t(`actions.${SUCCESS_KEY[success.action]}`, { time: success.time })}
        </p>
        {success.queued ? (
          <p className="max-w-xs text-body">{t("offline.savedOnDevice")}</p>
        ) : null}
      </div>
    );
  }

  const busy = disabled || pending !== null;

  if (state === "off") {
    return (
      <Button
        size="xl"
        variant={mainVariant}
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
          size="xl"
          variant={mainVariant}
          loading={pending === "stopWork"}
          disabled={busy}
          onClick={() => void run("stopWork", onStopWork)}
        >
          {t("actions.stopWork")}
        </Button>
        <Button
          variant={sideVariant}
          wide
          loading={pending === "startBreak"}
          disabled={busy}
          onClick={() => void run("startBreak", onStartBreak)}
        >
          {t("actions.takeBreak")}
        </Button>
      </div>
    );
  }

  return (
    <Button
      size="xl"
      variant={mainVariant}
      loading={pending === "stopBreak"}
      disabled={busy}
      onClick={() => void run("stopBreak", onStopBreak)}
    >
      {t("actions.resumeWork")}
    </Button>
  );
}
