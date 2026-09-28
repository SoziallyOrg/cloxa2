/**
 * Pure geometry for the manager's team timeline (docs/design.md, "Timeline"):
 * a fixed 06:00–22:00 Brussels window, with every span expressed as a
 * percentage of it. Percentages go into SVG attributes, never inline styles
 * (the nonce CSP forbids those). No I/O.
 */
import type { Shift } from "@cloxa/domain";
import { brusselsLocalToInstant } from "@cloxa/i18n";

export const TIMELINE_START_HOUR = 6;
export const TIMELINE_END_HOUR = 22;
/** The hour labels above the timeline. */
export const TIMELINE_AXIS_HOURS = [6, 9, 12, 15, 18, 21] as const;

export interface TimelineWindow {
  /** Epoch ms of 06:00 Brussels on the day. */
  readonly start: number;
  /** Epoch ms of 22:00 Brussels on the day. */
  readonly end: number;
}

/** A span on the track, in percent of the window (0–100). */
export interface TimelineSpan {
  readonly startPct: number;
  readonly widthPct: number;
}

export interface TimelineRowModel {
  /** Worked time (the ink bars), breaks included: breaks are drawn on top. */
  readonly work: readonly TimelineSpan[];
  readonly breaks: readonly TimelineSpan[];
  /** Scheduled but not (yet) worked: dashed outlines. */
  readonly planned: readonly TimelineSpan[];
  /** Where a shift that is still open ends right now, for the moving edge. */
  readonly openEdgePct: number | null;
}

export interface PlannedBlock {
  readonly start: number;
  readonly end: number;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** The 06:00–22:00 window of a Brussels day (`YYYY-MM-DD`), DST included. */
export function timelineWindow(dayKey: string): TimelineWindow {
  const pad = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
  return {
    start: brusselsLocalToInstant(dayKey, pad(TIMELINE_START_HOUR)).getTime(),
    end: brusselsLocalToInstant(dayKey, pad(TIMELINE_END_HOUR)).getTime(),
  };
}

/** Position of an instant in the window, in percent, clamped to 0–100. */
export function positionPct(at: number, window: TimelineWindow): number {
  const ratio = (at - window.start) / (window.end - window.start);
  return round(Math.min(100, Math.max(0, ratio * 100)));
}

/** The part of `[from, to]` inside the window, or `null` when nothing is left. */
export function toSpan(
  from: number,
  to: number,
  window: TimelineWindow,
): TimelineSpan | null {
  const start = Math.max(from, window.start);
  const end = Math.min(to, window.end);
  if (end <= start) return null;
  const startPct = positionPct(start, window);
  return { startPct, widthPct: round(positionPct(end, window) - startPct) };
}

/** The "now" hairline, or `null` outside 06:00–22:00. */
export function nowPct(now: number, window: TimelineWindow): number | null {
  return now < window.start || now > window.end ? null : positionPct(now, window);
}

/**
 * One person's row. `shifts` are the shifts to draw (the caller leaves out a
 * shift forgotten open since an earlier day: it is not work done today).
 * Planned blocks only show while nothing was worked that day, so a started
 * day stays calm.
 */
export function timelineRow(input: {
  shifts: readonly Shift[];
  planned: readonly PlannedBlock[];
  now: number;
  window: TimelineWindow;
}): TimelineRowModel {
  const { shifts, planned, now, window } = input;
  const spans = (list: (TimelineSpan | null)[]) =>
    list.filter((span): span is TimelineSpan => span !== null);

  const work = spans(
    shifts.map((shift) => toSpan(shift.start, shift.end ?? now, window)),
  );
  const breaks = spans(
    shifts.flatMap((shift) =>
      shift.breaks.map((pause) =>
        toSpan(pause.start, pause.end ?? (shift.open ? now : pause.start), window),
      ),
    ),
  );
  const open = shifts.find((shift) => shift.open);
  const openEdgePct =
    open && now > window.start && now <= window.end && open.start < window.end
      ? positionPct(now, window)
      : null;

  return {
    work,
    breaks,
    planned:
      shifts.length === 0
        ? spans(planned.map((block) => toSpan(block.start, block.end, window)))
        : [],
    openEdgePct,
  };
}
