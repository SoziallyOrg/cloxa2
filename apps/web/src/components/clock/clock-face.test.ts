import { describe, expect, it } from "vitest";

import type { Shift } from "@cloxa/domain";

import { clockFace, type PlannedDay } from "./clock-face";

// 2026-09-28 is a Monday; Brussels is UTC+2 (CEST).
const at = (hour: number, minute: number) => Date.UTC(2026, 8, 28, hour - 2, minute);

function openShift(start: number, breaks: Shift["breaks"] = []): Shift {
  return {
    start,
    end: null,
    breaks,
    grossMs: 0,
    breakMs: 0,
    netMs: 0,
    open: true,
    openBreak: breaks.some((brk) => brk.end === null),
    overnight: false,
    edited: false,
    hasOffline: false,
    offlineSkewMs: null,
  };
}

const PLANNED: PlannedDay = {
  start: at(8, 0),
  end: at(16, 30),
  netMs: 8.5 * 3_600_000,
  range: "08:00–16:30",
};

describe("clockFace", () => {
  it("shows today's plan and no timer when off", () => {
    const face = clockFace({
      state: "off",
      since: null,
      now: at(7, 30),
      todayShifts: [],
      pending: [],
      planned: PLANNED,
    });
    expect(face.timerMs).toBeNull();
    expect(face.plannedLine).toBe("Gepland 08:00–16:30");
    expect(face.progress).toBeNull();
  });

  it("shows nothing extra when off without a plan", () => {
    const face = clockFace({
      state: "off",
      since: null,
      now: at(7, 30),
      todayShifts: [],
      pending: [],
      planned: null,
    });
    expect(face.plannedLine).toBeNull();
    expect(face.subline).toBeNull();
  });

  it("counts worked time minus closed breaks while working", () => {
    const since = at(8, 2);
    const face = clockFace({
      state: "working",
      since,
      now: at(11, 56),
      todayShifts: [openShift(since, [{ start: at(10, 0), end: at(10, 30) }])],
      pending: [],
      planned: PLANNED,
    });
    expect(face.timerMs).toBe((3 * 60 + 24) * 60_000);
    expect(face.subline).toBe("Gestart om 08:02 · pauze 30 min");
    expect(face.timerSpoken).toBe("3 u 24 min gewerkt");
    expect(face.progress).toEqual({
      value: (3 * 60 + 24) * 60_000,
      max: PLANNED.netMs,
      startLabel: "08:00",
      endLabel: "gepland tot 16:30",
    });
  });

  it('says "geen pauze" before the first break', () => {
    const since = at(8, 2);
    const face = clockFace({
      state: "working",
      since,
      now: at(9, 0),
      todayShifts: [openShift(since)],
      pending: [],
      planned: null,
    });
    expect(face.subline).toBe("Gestart om 08:02 · geen pauze");
    expect(face.progress).toBeNull();
  });

  it("times the break itself while on break, and freezes worked time", () => {
    const since = at(8, 0);
    const face = clockFace({
      state: "on_break",
      since,
      now: at(12, 12),
      todayShifts: [openShift(since, [{ start: at(12, 0), end: null }])],
      pending: [],
      planned: PLANNED,
    });
    expect(face.timerMs).toBe(12 * 60_000);
    expect(face.subline).toBe("Gestart om 08:00 · pauze sinds 12:00");
    expect(face.progress?.value).toBe(4 * 3_600_000);
  });

  it("applies breaks still queued on the device", () => {
    const since = at(8, 0);
    const face = clockFace({
      state: "on_break",
      since,
      now: at(12, 10),
      todayShifts: [openShift(since)],
      pending: [{ type: "break_start", capturedAt: new Date(at(12, 5)).toISOString() }],
      planned: null,
    });
    expect(face.timerMs).toBe(5 * 60_000);
    expect(face.subline).toBe("Gestart om 08:00 · pauze sinds 12:05");
  });
});
