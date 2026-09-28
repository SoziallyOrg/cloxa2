import { describe, expect, it } from "vitest";

import { deriveShifts, type ClockEvent } from "@cloxa/domain";

import { workedMs } from "@/components/clock/week-total";

import {
  boardWindow,
  nowPct,
  timelineRow,
  timelineWindow,
  toSpan,
  windowTicks,
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

describe("timelineRow", () => {
  const window = timelineWindow("2026-09-28");
  const now = at("2026-09-28T12:00:00+02:00");

  it("counts an open shift up to now, minus an open break", () => {
    const [shift] = deriveShifts([
      event("a", "clock_in", "2026-09-28T08:00:00+02:00"),
      event("b", "break_start", "2026-09-28T11:30:00+02:00"),
    ]);
    expect(workedMs(shift!, now)).toBe(3.5 * 3600 * 1000);

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
    expect(workedMs(shift!, now)).toBe(2 * 3600 * 1000);
    expect(
      timelineRow({ shifts: [shift!], planned: [], now, window }).openEdgePct,
    ).toBe(null);
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

describe("boardWindow", () => {
  const iso = (ms: number) => new Date(ms).toISOString();
  const night = {
    start: at("2026-09-28T21:30:00+02:00"),
    end: at("2026-09-29T06:00:00+02:00"),
  };

  it("stays 06-22 by day", () => {
    const now = at("2026-09-28T12:00:00+02:00");
    expect(
      boardWindow({ dayKey: "2026-09-28", now, shiftStarts: [], planned: [] }),
    ).toEqual(timelineWindow("2026-09-28"));
  });

  it("reaches back to a night shift's start by day, keeping the usual end", () => {
    const window = boardWindow({
      dayKey: "2026-09-29",
      now: at("2026-09-29T10:00:00+02:00"),
      shiftStarts: [night.start],
      planned: [],
    });
    expect(iso(window.start)).toBe("2026-09-28T19:00:00.000Z");
    expect(window.end).toBe(timelineWindow("2026-09-29").end);
  });

  it("at 01:13 runs from yesterday 21:00 to one hour after the planned end", () => {
    const window = boardWindow({
      dayKey: "2026-09-29",
      now: at("2026-09-29T01:13:00+02:00"),
      shiftStarts: [night.start],
      planned: [
        night,
        // Not begun yet: does not stretch the window.
        {
          start: at("2026-09-29T13:00:00+02:00"),
          end: at("2026-09-29T21:00:00+02:00"),
        },
      ],
    });
    expect(iso(window.start)).toBe("2026-09-28T19:00:00.000Z");
    expect(iso(window.end)).toBe("2026-09-29T05:00:00.000Z");
  });

  it("never starts before 18:00 the previous day", () => {
    const window = boardWindow({
      dayKey: "2026-09-29",
      now: at("2026-09-29T09:00:00+02:00"),
      shiftStarts: [at("2026-09-27T20:00:00+02:00")],
      planned: [],
    });
    expect(iso(window.start)).toBe("2026-09-28T16:00:00.000Z");
  });

  it("looks back to 18:00 at night even with nothing open", () => {
    const window = boardWindow({
      dayKey: "2026-09-29",
      now: at("2026-09-29T01:13:00+02:00"),
      shiftStarts: [],
      planned: [],
    });
    expect(iso(window.start)).toBe("2026-09-28T16:00:00.000Z");
    expect(window.end).toBe(timelineWindow("2026-09-29").start);
  });

  it("extends past 22:00 for late work", () => {
    const window = boardWindow({
      dayKey: "2026-09-28",
      now: at("2026-09-28T23:20:00+02:00"),
      shiftStarts: [at("2026-09-28T15:00:00+02:00")],
      planned: [],
    });
    expect(iso(window.end)).toBe("2026-09-28T23:00:00.000Z");
  });

  it("keeps whole hours on the spring-forward night", () => {
    // 29 March 2026: 02:00 becomes 03:00, so the night is one hour short.
    const window = boardWindow({
      dayKey: "2026-03-29",
      now: at("2026-03-29T04:30:00+02:00"),
      shiftStarts: [at("2026-03-28T21:30:00+01:00")],
      planned: [
        {
          start: at("2026-03-28T21:30:00+01:00"),
          end: at("2026-03-29T06:00:00+02:00"),
        },
      ],
    });
    expect(iso(window.start)).toBe("2026-03-28T20:00:00.000Z");
    expect(iso(window.end)).toBe("2026-03-29T05:00:00.000Z");
    expect(windowTicks(window).map(([hour]) => hour)).toEqual([21, 0, 3, 6]);
  });

  it("keeps whole hours on the fall-back night (an hour longer)", () => {
    // 25 October 2026: 03:00 becomes 02:00.
    const window = boardWindow({
      dayKey: "2026-10-25",
      now: at("2026-10-25T03:30:00+01:00"),
      shiftStarts: [at("2026-10-24T21:30:00+02:00")],
      planned: [
        {
          start: at("2026-10-24T21:30:00+02:00"),
          end: at("2026-10-25T06:00:00+01:00"),
        },
      ],
    });
    expect(iso(window.start)).toBe("2026-10-24T19:00:00.000Z");
    expect(iso(window.end)).toBe("2026-10-25T06:00:00.000Z");
    expect(window.start % 3_600_000).toBe(0);
    expect(window.end % 3_600_000).toBe(0);
  });
});

describe("windowTicks", () => {
  it("is 6, 9, ... 21 for the normal window", () => {
    expect(windowTicks(timelineWindow("2026-09-28")).map(([hour]) => hour)).toEqual([
      6, 9, 12, 15, 18, 21,
    ]);
  });

  it("reads the Brussels clock across midnight", () => {
    const window = boardWindow({
      dayKey: "2026-09-29",
      now: at("2026-09-29T01:13:00+02:00"),
      shiftStarts: [at("2026-09-28T21:30:00+02:00")],
      planned: [],
    });
    expect(windowTicks(window).map(([hour]) => hour)).toEqual([21, 0, 3]);
  });
});

describe("timelineRow across midnight", () => {
  it("draws a shift from yesterday inside the night window from its own start", () => {
    const now = at("2026-09-29T01:13:00+02:00");
    const window = boardWindow({
      dayKey: "2026-09-29",
      now,
      shiftStarts: [at("2026-09-28T21:30:00+02:00")],
      planned: [],
    });
    const [shift] = deriveShifts([event("a", "clock_in", "2026-09-28T21:30:00+02:00")]);
    const row = timelineRow({ shifts: [shift!], planned: [], now, window });
    expect(row.work[0]!.continuesLeft).toBeUndefined();
    expect(row.work[0]!.startPct).toBeGreaterThan(0);
    expect(row.openEdgePct).not.toBeNull();
  });

  it("starts at the axis start when the shift began before the window", () => {
    const [shift] = deriveShifts([event("a", "clock_in", "2026-09-28T21:30:00+02:00")]);
    const row = timelineRow({
      shifts: [shift!],
      planned: [],
      now: at("2026-09-29T08:00:00+02:00"),
      window: timelineWindow("2026-09-29"),
    });
    expect(row.work[0]).toMatchObject({ startPct: 0, continuesLeft: true });
  });
});
