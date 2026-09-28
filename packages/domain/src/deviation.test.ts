import { describe, expect, it } from "vitest";

import { deviationFromSchedule } from "./deviation";
import type { Shift } from "./shifts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function shift(
  overrides: Partial<Shift> & { start: number; end: number | null },
): Shift {
  return {
    breaks: [],
    grossMs: 0,
    breakMs: 0,
    netMs: 0,
    open: overrides.end === null,
    openBreak: false,
    overnight: false,
    edited: false,
    hasOffline: false,
    ...overrides,
  };
}

describe("deviationFromSchedule", () => {
  it("returns zeros for no shifts and no schedule", () => {
    expect(deviationFromSchedule([], [])).toEqual({
      plannedMs: 0,
      workedNetMs: 0,
      deltaMs: 0,
      lateStartMs: 0,
      earlyEndMs: 0,
    });
  });

  it("reports workedNetMs with no schedule at all", () => {
    const start = Date.UTC(2026, 5, 1, 9, 0);
    const worked = shift({ start, end: start + 8 * HOUR, netMs: 8 * HOUR });

    const result = deviationFromSchedule([worked], []);

    expect(result.plannedMs).toBe(0);
    expect(result.workedNetMs).toBe(8 * HOUR);
    expect(result.deltaMs).toBe(8 * HOUR);
    expect(result.lateStartMs).toBe(0);
    expect(result.earlyEndMs).toBe(0);
  });

  it("reports a late start", () => {
    const plannedStart = Date.UTC(2026, 5, 1, 9, 0);
    const plannedEnd = plannedStart + 8 * HOUR;
    const actualStart = plannedStart + 20 * MINUTE;

    const worked = shift({
      start: actualStart,
      end: actualStart + 8 * HOUR,
      netMs: 8 * HOUR,
    });

    const result = deviationFromSchedule(
      [worked],
      [{ start: plannedStart, end: plannedEnd }],
    );

    expect(result.plannedMs).toBe(8 * HOUR);
    expect(result.lateStartMs).toBe(20 * MINUTE);
    expect(result.earlyEndMs).toBe(0);
  });

  it("reports an early end", () => {
    const plannedStart = Date.UTC(2026, 5, 1, 9, 0);
    const plannedEnd = plannedStart + 8 * HOUR;
    const actualEnd = plannedEnd - 30 * MINUTE;

    const worked = shift({
      start: plannedStart,
      end: actualEnd,
      netMs: actualEnd - plannedStart,
    });

    const result = deviationFromSchedule(
      [worked],
      [{ start: plannedStart, end: plannedEnd }],
    );

    expect(result.lateStartMs).toBe(0);
    expect(result.earlyEndMs).toBe(30 * MINUTE);
    expect(result.deltaMs).toBe(result.workedNetMs - result.plannedMs);
  });

  it("does not report an early end for a shift that is still open", () => {
    const plannedStart = Date.UTC(2026, 5, 1, 9, 0);
    const plannedEnd = plannedStart + 8 * HOUR;

    const worked = shift({ start: plannedStart, end: null, netMs: 4 * HOUR });

    const result = deviationFromSchedule(
      [worked],
      [{ start: plannedStart, end: plannedEnd }],
    );

    expect(result.earlyEndMs).toBe(0);
  });

  it("does not report a late start or early end for an exact match", () => {
    const plannedStart = Date.UTC(2026, 5, 1, 9, 0);
    const plannedEnd = plannedStart + 8 * HOUR;

    const worked = shift({ start: plannedStart, end: plannedEnd, netMs: 8 * HOUR });

    const result = deviationFromSchedule(
      [worked],
      [{ start: plannedStart, end: plannedEnd }],
    );

    expect(result.lateStartMs).toBe(0);
    expect(result.earlyEndMs).toBe(0);
    expect(result.deltaMs).toBe(0);
  });

  it("reports plannedMs with no shifts worked (a no-show)", () => {
    const plannedStart = Date.UTC(2026, 5, 1, 9, 0);
    const plannedEnd = plannedStart + 8 * HOUR;

    const result = deviationFromSchedule(
      [],
      [{ start: plannedStart, end: plannedEnd }],
    );

    expect(result.plannedMs).toBe(8 * HOUR);
    expect(result.workedNetMs).toBe(0);
    expect(result.deltaMs).toBe(-8 * HOUR);
    expect(result.lateStartMs).toBe(0);
    expect(result.earlyEndMs).toBe(0);
  });
});
