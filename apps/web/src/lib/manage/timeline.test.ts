import { describe, expect, it } from "vitest";

import { deriveShifts, type ClockEvent } from "@cloxa/domain";

import {
  netUntil,
  nowPct,
  timelineRow,
  timelineWindow,
  toSpan,
} from "./timeline";

const at = (iso: string) => Date.parse(iso);

function event(id: string, type: ClockEvent["type"], iso: string): ClockEvent {
  return {
    id,
    type,
    occurredAt: at(iso),
    employeeId: "emp-1",
    siteId: "site-1",
    source: "app",
  };
}

describe("timelineWindow", () => {
  it("spans 06:00–22:00 Brussels in summer time", () => {
    const window = timelineWindow("2026-09-28");
    expect(new Date(window.start).toISOString()).toBe("2026-09-28T04:00:00.000Z");
    expect(new Date(window.end).toISOString()).toBe("2026-09-28T20:00:00.000Z");
  });

  it("spans 06:00–22:00 Brussels on the autumn DST day", () => {
    // Clocks go back at 03:00 on 25 October 2026: 06:00 is already CET.
    const window = timelineWindow("2026-10-25");
    expect(new Date(window.start).toISOString()).toBe("2026-10-25T05:00:00.000Z");
    expect(window.end - window.start).toBe(16 * 3600 * 1000);
  });
});

describe("toSpan", () => {
  const window = timelineWindow("2026-09-28");

  it("places 14:00–18:00 at 50%, 25% wide", () => {
    expect(
      toSpan(at("2026-09-28T14:00:00+02:00"), at("2026-09-28T18:00:00+02:00"), window),
    ).toEqual({ startPct: 50, widthPct: 25 });
  });

  it("clips what falls outside 06–22", () => {
    expect(
      toSpan(at("2026-09-28T05:00:00+02:00"), at("2026-09-28T07:00:00+02:00"), window),
    ).toEqual({ startPct: 0, widthPct: 6.25 });
    expect(
      toSpan(at("2026-09-28T22:30:00+02:00"), at("2026-09-28T23:00:00+02:00"), window),
    ).toBeNull();
  });
});

describe("nowPct", () => {
  const window = timelineWindow("2026-09-28");

  it("is null before 06:00 and after 22:00", () => {
    expect(nowPct(at("2026-09-28T05:59:00+02:00"), window)).toBeNull();
    expect(nowPct(at("2026-09-28T22:01:00+02:00"), window)).toBeNull();
    expect(nowPct(at("2026-09-28T10:00:00+02:00"), window)).toBe(25);
  });
});

describe("netUntil and timelineRow", () => {
  const window = timelineWindow("2026-09-28");
  const now = at("2026-09-28T12:00:00+02:00");

  it("counts an open shift up to now, minus an open break", () => {
    const [shift] = deriveShifts([
      event("a", "clock_in", "2026-09-28T08:00:00+02:00"),
      event("b", "break_start", "2026-09-28T11:30:00+02:00"),
    ]);
    expect(netUntil(shift!, now)).toBe(3.5 * 3600 * 1000);

    const row = timelineRow({ shifts: [shift!], planned: [], now, window });
    expect(row.work).toEqual([{ startPct: 12.5, widthPct: 25 }]);
    expect(row.breaks).toEqual([{ startPct: 34.375, widthPct: 3.125 }]);
    expect(row.openEdgePct).toBe(37.5);
  });

  it("uses the recorded net for a closed shift", () => {
    const [shift] = deriveShifts([
      event("a", "clock_in", "2026-09-28T07:00:00+02:00"),
      event("b", "clock_out", "2026-09-28T09:00:00+02:00"),
    ]);
    expect(netUntil(shift!, now)).toBe(2 * 3600 * 1000);
    expect(timelineRow({ shifts: [shift!], planned: [], now, window }).openEdgePct).toBe(
      null,
    );
  });

  it("shows the plan as an outline only while nothing was worked", () => {
    const planned = [
      { start: at("2026-09-28T13:00:00+02:00"), end: at("2026-09-28T21:00:00+02:00") },
    ];
    expect(timelineRow({ shifts: [], planned, now, window }).planned).toEqual([
      { startPct: 43.75, widthPct: 50 },
    ]);
    const [shift] = deriveShifts([event("a", "clock_in", "2026-09-28T11:00:00+02:00")]);
    expect(timelineRow({ shifts: [shift!], planned, now, window }).planned).toEqual([]);
  });
});
