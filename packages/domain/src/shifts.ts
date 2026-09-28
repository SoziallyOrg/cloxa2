/**
 * Derive `Shift[]` from a single employee's effective, sorted event log.
 * Group raw events by `employeeId` and run them through `effectiveEvents`
 * before calling this function.
 *
 * No wall-clock reads: an open shift or open break has no end, so its
 * gross/break/net durations are computed up to the last event actually in
 * the log, never against "now". A caller that wants "worked so far" adds
 * `Date.now() - lastEventAt` itself.
 */

import { brusselsDayKey } from "./brussels-day-key";
import type { ClockEvent } from "./clock-event";

export interface ShiftBreak {
  readonly start: number;
  readonly end: number | null;
}

export interface Shift {
  readonly start: number;
  readonly end: number | null;
  readonly breaks: readonly ShiftBreak[];
  /** end (or the last known event) minus start. */
  readonly grossMs: number;
  /** Sum of closed break durations. */
  readonly breakMs: number;
  /** grossMs - breakMs. */
  readonly netMs: number;
  readonly open: boolean;
  readonly openBreak: boolean;
  /** Crosses midnight in Europe/Brussels. */
  readonly overnight: boolean;
  /** Any event in this shift has source "correction". */
  readonly edited: boolean;
  /** Any event in this shift was queued offline and synced later. */
  readonly hasOffline: boolean;
  /**
   * The longest delay between an offline event and its arrival at the server
   * (`serverAt - occurredAt`), or null when unknown or there is none.
   */
  readonly offlineSkewMs: number | null;
}

interface OpenShift {
  start: number;
  breaks: { start: number; end: number | null }[];
  edited: boolean;
  hasOffline: boolean;
  offlineSkewMs: number | null;
  cursor: number;
}

export function deriveShifts(events: readonly ClockEvent[]): Shift[] {
  const shifts: Shift[] = [];
  let open: OpenShift | null = null;

  for (const event of events) {
    const edited = event.source === "correction";
    const offline = event.offline === true;
    const skew =
      offline && event.serverAt !== undefined
        ? event.serverAt - event.occurredAt
        : null;

    switch (event.type) {
      case "clock_in": {
        open = {
          start: event.occurredAt,
          breaks: [],
          edited,
          hasOffline: offline,
          offlineSkewMs: skew,
          cursor: event.occurredAt,
        };
        break;
      }
      case "break_start": {
        if (open === null) break; // invalid sequence: caller validates separately.
        open.breaks.push({ start: event.occurredAt, end: null });
        open.edited = open.edited || edited;
        open.hasOffline = open.hasOffline || offline;
        open.offlineSkewMs = maxSkew(open.offlineSkewMs, skew);
        open.cursor = event.occurredAt;
        break;
      }
      case "break_end": {
        if (open === null) break;
        const lastBreak = open.breaks.at(-1);
        if (lastBreak !== undefined && lastBreak.end === null) {
          lastBreak.end = event.occurredAt;
        }
        open.edited = open.edited || edited;
        open.hasOffline = open.hasOffline || offline;
        open.offlineSkewMs = maxSkew(open.offlineSkewMs, skew);
        open.cursor = event.occurredAt;
        break;
      }
      case "clock_out": {
        if (open === null) break;
        open.edited = open.edited || edited;
        open.hasOffline = open.hasOffline || offline;
        open.offlineSkewMs = maxSkew(open.offlineSkewMs, skew);
        open.cursor = event.occurredAt;
        shifts.push(finalizeShift(open, event.occurredAt));
        open = null;
        break;
      }
      case "void": {
        // Effective events never contain void; ignore defensively.
        break;
      }
    }
  }

  if (open !== null) {
    shifts.push(finalizeShift(open, null));
  }

  return shifts;
}

function maxSkew(current: number | null, next: number | null): number | null {
  if (next === null) return current;
  return current === null ? next : Math.max(current, next);
}

function finalizeShift(open: OpenShift, end: number | null): Shift {
  const referenceEnd = end ?? open.cursor;
  const breakMs = open.breaks.reduce(
    (sum, brk) => sum + ((brk.end ?? brk.start) - brk.start),
    0,
  );
  const grossMs = referenceEnd - open.start;

  return {
    start: open.start,
    end,
    breaks: open.breaks.map((brk) => ({ start: brk.start, end: brk.end })),
    grossMs,
    breakMs,
    netMs: grossMs - breakMs,
    open: end === null,
    openBreak: open.breaks.some((brk) => brk.end === null),
    overnight: brusselsDayKey(open.start) !== brusselsDayKey(referenceEnd),
    edited: open.edited,
    hasOffline: open.hasOffline,
    offlineSkewMs: open.offlineSkewMs,
  };
}
