/**
 * Pure formatting helpers for the clock UI, extracted so they're unit
 * testable without a DOM (root vitest config runs in a `node` environment).
 */
import { formatBrusselsTime, t } from "@cloxa/i18n";

import type { ShiftState } from "@cloxa/domain";
import type { StatusTone } from "../ui/StatusBadge";

/**
 * "3 u 12 min", "8 u" (no zero minutes) or "30 min" (no zero hours), floored
 * to the minute, never negative. A zero duration reads as "0 min", not "".
 */
export function formatElapsed(sinceMs: number, nowMs: number): string {
  const totalMinutes = Math.max(0, Math.floor((nowMs - sinceMs) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours} ${t("status.elapsedHours")} ${minutes} ${t("status.elapsedMinutes")}`;
  }

  if (hours > 0) {
    return `${hours} ${t("status.elapsedHours")}`;
  }

  return `${minutes} ${t("status.elapsedMinutes")}`;
}

/** Same style as `formatElapsed`, for a closed duration. */
export function formatDurationMs(durationMs: number): string {
  return formatElapsed(0, durationMs);
}

/** Colour tone for the big status indicator. */
export function statusTone(state: ShiftState): StatusTone {
  if (state === "working") return "working";
  if (state === "on_break") return "break";
  return "off";
}

/** The single word next to the status dot, e.g. "Aan het werk". */
export function statusWord(state: ShiftState): string {
  if (state === "working") return t("status.workingLabel");
  if (state === "on_break") return t("status.breakLabel");
  return t("status.offLabel");
}

/**
 * The big status sentence: "Je bent aan het werk sinds 08:02", etc.
 * `since` is required whenever `state` isn't "off".
 */
export function statusHeadline(state: ShiftState, since: number | null): string {
  if (state === "working" && since !== null) {
    return t("status.workingSince", { time: formatBrusselsTime(new Date(since)) });
  }

  if (state === "on_break" && since !== null) {
    return t("status.breakSince", { time: formatBrusselsTime(new Date(since)) });
  }

  return t("status.off");
}
