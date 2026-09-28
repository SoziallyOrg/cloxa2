/**
 * What the clock screen shows, as pure data: the timer, the line under it
 * and the progress against today's schedule. Display only: the state itself
 * comes from the server (plus queued offline actions, see `displayedState`).
 */
import { formatBrusselsTime, t } from "@cloxa/i18n";
import type { Shift, ShiftState } from "@cloxa/domain";

import { formatDurationMs } from "./format";

/** A clock action still queued on the device (offline), oldest first. */
export interface PendingClockAction {
  readonly type: "clock_in" | "clock_out" | "break_start" | "break_end";
  readonly capturedAt: string;
}

/** Today's schedule: first start, last end and the planned working time. */
export interface PlannedDay {
  readonly start: number;
  readonly end: number;
  readonly netMs: number;
  /** "08:00–16:30" (or joined blocks). */
  readonly range: string;
}

export interface ClockFaceInput {
  state: ShiftState;
  /** Start of the open shift, `null` when off. */
  since: number | null;
  now: number;
  todayShifts: readonly Shift[];
  pending: readonly PendingClockAction[];
  planned: PlannedDay | null;
}

export interface ClockFace {
  /** Worked time while working, the break so far while on break; null when off. */
  timerMs: number | null;
  timerSpoken: string | null;
  /** "Gestart om 08:02 · geen pauze". */
  subline: string | null;
  progress: { value: number; max: number; startLabel: string; endLabel: string } | null;
  /** Off, with a schedule today: "Gepland 08:00–16:30". */
  plannedLine: string | null;
}

const time = (ms: number) => formatBrusselsTime(new Date(ms));

/** Closed break time and an open break's start, for the open shift. */
function openShiftBreaks(
  since: number,
  todayShifts: readonly Shift[],
  pending: readonly PendingClockAction[],
): { breakMs: number; breakSince: number | null } {
  let breakMs = 0;
  let breakSince: number | null = null;

  const open = todayShifts.find((shift) => shift.open && shift.start === since);
  for (const brk of open?.breaks ?? []) {
    if (brk.end === null) breakSince = brk.start;
    else breakMs += brk.end - brk.start;
  }

  for (const entry of pending) {
    const at = Date.parse(entry.capturedAt);
    if (entry.type === "clock_in" || entry.type === "clock_out") {
      breakMs = 0;
      breakSince = null;
    } else if (entry.type === "break_start") {
      breakSince = at;
    } else if (breakSince !== null) {
      breakMs += Math.max(0, at - breakSince);
      breakSince = null;
    }
  }

  return { breakMs, breakSince };
}

export function clockFace({
  state,
  since,
  now,
  todayShifts,
  pending,
  planned,
}: ClockFaceInput): ClockFace {
  if (state === "off" || since === null) {
    return {
      timerMs: null,
      timerSpoken: null,
      subline: null,
      progress: null,
      plannedLine: planned
        ? t("schedule.todayPlanned", { range: planned.range })
        : null,
    };
  }

  const { breakMs, breakSince } = openShiftBreaks(since, todayShifts, pending);
  const onBreak = state === "on_break";
  const breakStart = onBreak ? (breakSince ?? now) : null;
  const workedMs = Math.max(0, (breakStart ?? now) - since - breakMs);
  const timerMs = breakStart !== null ? Math.max(0, now - breakStart) : workedMs;

  const second =
    breakStart !== null
      ? t("clock.breakSince", { time: time(breakStart) })
      : breakMs > 0
        ? t("clock.breakTotal", { value: formatDurationMs(breakMs) })
        : t("clock.noBreak");

  return {
    timerMs,
    timerSpoken:
      breakStart !== null
        ? t("clock.breakSpoken", { value: formatDurationMs(timerMs) })
        : t("clock.workedSpoken", { value: formatDurationMs(timerMs) }),
    subline: `${t("clock.startedAt", { time: time(since) })} · ${second}`,
    progress: planned
      ? {
          value: workedMs,
          max: planned.netMs,
          startLabel: time(planned.start),
          endLabel: t("clock.plannedUntil", { time: time(planned.end) }),
        }
      : null,
    plannedLine: null,
  };
}
