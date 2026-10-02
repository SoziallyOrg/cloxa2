/**
 * What the clock bar shows, as pure data. The numbers come from the same
 * `clockFace` as the Klok screen, so the bar and Klok never disagree.
 */
import { t } from "@cloxa/i18n";
import type { Shift, ShiftState } from "@cloxa/domain";

import { clockFace, type PendingClockAction } from "./clock-face";
import { formatDurationMs } from "./format";

/** Without a plan the ring measures against a standard 8-hour day (docs/design.md). */
export const DEFAULT_RING_MS = 8 * 3_600_000;

export type ClockBarKind = "working" | "on_break";

export interface ClockBarInput {
  state: ShiftState;
  since: number | null;
  now: number;
  /** Only the open shift is needed (its breaks). */
  todayShifts: readonly Shift[];
  pending: readonly PendingClockAction[];
  /** Planned working time of the shift in ms, when known. */
  plannedMs?: number | null;
}

export interface ClockBarModel {
  kind: ClockBarKind;
  /** "Jij werkt" or "Je bent op pauze". */
  title: string;
  /** "4u 12": worked time, or the break so far while on break. */
  time: string;
  spoken: string;
  /** Worked time against the plan (or 8 hours), 0-1. */
  progress: number;
  /** The first button: "Pauze", or "Verder werken" on break. */
  secondaryAction: "startBreak" | "stopBreak";
  secondaryLabel: string;
  stopLabel: string;
}

/** "4u 12", "0u 05": hours and zero-padded minutes, floored, never negative. */
export function formatBarTime(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  return t("shell.clockBarTime", {
    hours: Math.floor(totalMinutes / 60),
    minutes: String(totalMinutes % 60).padStart(2, "0"),
  });
}

/** `null` when the person is not clocked in: the bar is then not shown at all. */
export function clockBarModel(input: ClockBarInput): ClockBarModel | null {
  if (input.state === "off" || input.since === null) return null;

  const face = clockFace({ ...input, planned: null });
  if (face.timerMs === null || face.workedMs === null) return null;

  const onBreak = input.state === "on_break";
  const target =
    input.plannedMs && input.plannedMs > 0 ? input.plannedMs : DEFAULT_RING_MS;

  return {
    kind: onBreak ? "on_break" : "working",
    title: onBreak ? t("shell.clockBarOnBreak") : t("shell.clockBarWorking"),
    time: formatBarTime(face.timerMs),
    spoken: t(onBreak ? "clock.breakSpoken" : "clock.workedSpoken", {
      value: formatDurationMs(face.timerMs),
    }),
    progress: Math.min(1, face.workedMs / target),
    secondaryAction: onBreak ? "stopBreak" : "startBreak",
    secondaryLabel: onBreak ? t("shell.clockBarResume") : t("shell.clockBarPause"),
    stopLabel: t("shell.clockBarStop"),
  };
}
