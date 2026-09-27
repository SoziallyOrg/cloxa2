"use client";

import { useEffect, useState } from "react";

import { formatBrusselsTime, t } from "@cloxa/i18n";
import type { ShiftState } from "@cloxa/domain";

import { Button } from "../ui/Button";
import { Stack } from "../ui/Stack";
import { IconCheck } from "../ui/icons";

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

const SUCCESS_DISPLAY_MS = 2500;

export interface ClockActionsProps {
  state: ShiftState;
  onStartWork: () => void | Promise<void>;
  onStopWork: () => void | Promise<void>;
  onStartBreak: () => void | Promise<void>;
  onStopBreak: () => void | Promise<void>;
  /**
   * Renders the success confirmation immediately, as if `action` had just
   * completed at `time`. For the design preview only — real usage always
   * reaches success through a click.
   */
  previewSuccess?: { action: ActionKind; time: string };
}

/**
 * The clock action(s) for the current state, plus pending and success
 * feedback. Callbacks only — no data fetching, so this stays reusable
 * across the employee app and the kiosk.
 */
export function ClockActions({
  state,
  onStartWork,
  onStopWork,
  onStartBreak,
  onStopBreak,
  previewSuccess,
}: ClockActionsProps) {
  const [pending, setPending] = useState<ActionKind | null>(null);
  const [success, setSuccess] = useState<{ action: ActionKind; time: string } | null>(
    previewSuccess ?? null,
  );

  useEffect(() => {
    if (success === null) return;

    const timer = window.setTimeout(() => setSuccess(null), SUCCESS_DISPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [success]);

  async function run(action: ActionKind, callback: () => void | Promise<void>) {
    setPending(action);
    await callback();
    setPending(null);
    setSuccess({ action, time: formatBrusselsTime(new Date()) });

    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(50);
    }
  }

  if (success !== null) {
    return (
      <div role="status" className="flex flex-col items-center gap-3 py-4 text-center">
        <IconCheck className="size-16 text-status-working" />
        <p className="text-xl font-semibold">
          {t(`actions.${SUCCESS_KEY[success.action]}`, { time: success.time })}
        </p>
      </div>
    );
  }

  if (state === "off") {
    return (
      <Button
        size="xl"
        variant="primary"
        loading={pending === "startWork"}
        onClick={() => void run("startWork", onStartWork)}
      >
        {t("actions.startWork")}
      </Button>
    );
  }

  if (state === "working") {
    return (
      <Stack gap="md">
        <Button
          size="xl"
          variant="primary"
          loading={pending === "stopWork"}
          onClick={() => void run("stopWork", onStopWork)}
        >
          {t("actions.stopWork")}
        </Button>
        <Button
          size="lg"
          variant="secondary"
          loading={pending === "startBreak"}
          onClick={() => void run("startBreak", onStartBreak)}
        >
          {t("actions.startBreak")}
        </Button>
      </Stack>
    );
  }

  return (
    <Button
      size="xl"
      variant="primary"
      loading={pending === "stopBreak"}
      onClick={() => void run("stopBreak", onStopBreak)}
    >
      {t("actions.stopBreak")}
    </Button>
  );
}
