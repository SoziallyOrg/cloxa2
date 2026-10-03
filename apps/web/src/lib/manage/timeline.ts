/**
 * Pure geometry for the manager's team timeline (docs/design.md, "Timeline"):
 * a fixed 06:00–22:00 Brussels window, with every span expressed as a
 * percentage of it. Percentages go into SVG attributes, never inline styles
 * (the nonce CSP forbids those). No I/O.
 */
import type { Shift } from "@cloxa/domain";
import { brusselsLocalToInstant, formatBrusselsTime } from "@cloxa/i18n";

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
  /** The work began before the window: draw a flat left edge ("loopt door van gisteren"). */
  readonly continuesLeft?: true;
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

const HOUR_MS = 3600 * 1000;
/** Never wider than this, so bars stay readable. */
const MAX_WINDOW_MS = 30 * HOUR_MS;

/** `YYYY-MM-DD` shifted by whole days (calendar arithmetic, no time zone). */
function addDays(dayKey: string, days: number): string {
  return new Date(Date.parse(`${dayKey}T00:00:00Z`) + days * 24 * HOUR_MS)
    .toISOString()
    .slice(0, 10);
}

/** 18:00 Brussels on the day before `dayKey`: how far back the board looks. */
export function nightLookbackStart(dayKey: string): number {
  return brusselsLocalToInstant(addDays(dayKey, -1), "18:00").getTime();
}

// Every Brussels UTC offset is a whole number of hours, so rounding an
// instant to a UTC hour also lands on a Brussels hour, DST included.
const floorHour = (at: number) => Math.floor(at / HOUR_MS) * HOUR_MS;
const ceilHour = (at: number) => Math.ceil(at / HOUR_MS) * HOUR_MS;

/**
 * The window of the Vandaag board. Normally 06:00–22:00. Extended when the
 * current state needs it: an open (or just-ended) shift that began before
 * 06:00, or it being night, reaches back to the earliest start (never before
 * 18:00 the previous day); a shift or planned block running past 22:00
 * reaches forward to one hour after max(now, planned end). Bounds stay on
 * whole hours.
 */
export function boardWindow(input: {
  dayKey: string;
  now: number;
  /** Starts of the shifts that are drawn. */
  shiftStarts: readonly number[];
  /** Planned blocks that are drawn. */
  planned: readonly PlannedBlock[];
}): TimelineWindow {
  const { dayKey, now, shiftStarts, planned } = input;
  const base = timelineWindow(dayKey);
  const lookback = nightLookbackStart(dayKey);

  const earlyStarts = [...shiftStarts, ...planned.map((block) => block.start)].filter(
    (at) => at < base.start,
  );
  const night = now < base.start;
  const start =
    earlyStarts.length > 0
      ? Math.max(lookback, floorHour(Math.min(...earlyStarts)))
      : night
        ? lookback
        : base.start;

  // Blocks that have begun tell how long the work may still run.
  const reach = [
    now,
    ...planned.filter((block) => block.start <= now).map((b) => b.end),
  ];
  const latest = Math.max(...reach);
  const wanted = ceilHour(latest + HOUR_MS);
  // At night the window ends shortly after the night's work, not at 22:00
  // tomorrow; by day it never shrinks below the usual 22:00.
  const end =
    latest > base.end ? wanted : night ? Math.max(wanted, base.start) : base.end;
  return { start, end: Math.min(end, start + MAX_WINDOW_MS) };
}

/**
 * Hour labels for the axis as `[hour, positionPct]`: every 3rd hour (every
 * 6th on wide windows), read on the Brussels clock.
 */
export function windowTicks(window: TimelineWindow): [number, number][] {
  const step = window.end - window.start > 18 * HOUR_MS ? 6 : 3;
  const ticks: [number, number][] = [];
  for (let at = window.start; at <= window.end; at += HOUR_MS) {
    const hour = Number(formatBrusselsTime(new Date(at)).slice(0, 2));
    if (hour % step === 0) ticks.push([hour, positionPct(at, window)]);
  }
  return ticks;
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
    shifts.map((shift) => {
      const span = toSpan(shift.start, shift.end ?? now, window);
      return span && shift.start < window.start
        ? { ...span, continuesLeft: true as const }
        : span;
    }),
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
