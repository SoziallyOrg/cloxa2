import { describe, expect, it } from "vitest";

import type { Shift } from "@cloxa/domain";

import { barWindow, buildHoursWeek, minutesOfDay, parseWeekParam } from "./hours-week";

// Week of Monday 2026-09-28; Brussels is UTC+2 (CEST).
const at = (day: number, hour: number, minute = 0) =>
  Date.UTC(2026, 8, day, hour - 2, minute);

function shift(partial: Partial<Shift> & Pick<Shift, "start">): Shift {
  return {
    end: null,
    breaks: [],
    grossMs: 0,
    breakMs: 0,
    netMs: 0,
    open: false,
    openBreak: false,
    overnight: false,
    edited: false,
    hasOffline: false,
    offlineSkewMs: null,
    ...partial,
  };
}

describe("minutesOfDay", () => {
  it("reads the wall clock in Brussels, summer and winter", () => {
    expect(minutesOfDay(at(28, 8, 30))).toBe(8 * 60 + 30);
    expect(minutesOfDay(Date.UTC(2026, 0, 12, 7, 15))).toBe(8 * 60 + 15);
  });
});

describe("barWindow", () => {
  it("is 06-22 and widens by whole hours", () => {
    expect(barWindow([{ start: 8 * 60, end: 17 * 60 }])).toEqual({
      start: 360,
      end: 1320,
    });
    expect(barWindow([{ start: 4 * 60 + 30, end: 23 * 60 + 10 }])).toEqual({
      start: 240,
      end: 1440,
    });
  });
});

describe("buildHoursWeek", () => {
  const closed = shift({
    start: at(28, 8),
    end: at(28, 16, 30),
    breaks: [{ start: at(28, 12), end: at(28, 12, 30) }],
    breakMs: 30 * 60_000,
    netMs: 8 * 3_600_000,
  });

  it("lists days up to today, newest first, with empty days kept", () => {
    const week = buildHoursWeek({
      shifts: [closed],
      now: at(30, 9),
      mondayKey: "2026-09-28",
      todayKey: "2026-09-30",
      planned: [
        {
          day: "2026-09-28",
          start_at: "2026-09-28T06:00:00Z",
          end_at: "2026-09-28T14:30:00Z",
        },
      ],
    });
    expect(week.days.map((day) => day.key)).toEqual([
      "2026-09-30",
      "2026-09-29",
      "2026-09-28",
    ]);
    const monday = week.days[2]!;
    expect(monday.hasShifts).toBe(true);
    expect(monday.range).toBe("08:00–16:30");
    expect(monday.start).toBe("08:00");
    expect(monday.end).toBe("16:30");
    expect(monday.planned).toBe("08:00–16:30");
    expect(week.days[0]!.hasShifts).toBe(false);
    expect(week.workedMs).toBe(8 * 3_600_000);
    expect(week.plannedMs).toBe(8.5 * 3_600_000);
  });

  it("puts work and break on the bar as percentages of the 06-22 window", () => {
    const week = buildHoursWeek({
      shifts: [closed],
      now: at(28, 18),
      mondayKey: "2026-09-28",
      todayKey: "2026-09-28",
      planned: [],
    });
    const day = week.days[0]!;
    // 08:00 is 2h into a 16h window; 08:00-16:30 is 8.5h long.
    expect(day.work[0]!.startPct).toBeCloseTo(12.5, 5);
    expect(day.work[0]!.widthPct).toBeCloseTo((8.5 / 16) * 100, 5);
    expect(day.breaks[0]!.startPct).toBeCloseTo((6 / 16) * 100, 5);
    expect(day.breaks[0]!.widthPct).toBeCloseTo((0.5 / 16) * 100, 5);
    expect(week.plannedMs).toBeNull();
  });

  it("counts an open shift up to now and says it is still going", () => {
    const open = shift({ start: at(28, 8), open: true });
    const week = buildHoursWeek({
      shifts: [open],
      now: at(28, 10, 30),
      mondayKey: "2026-09-28",
      todayKey: "2026-09-28",
      planned: [],
    });
    expect(week.days[0]!.end).toBe("nog bezig");
    expect(week.days[0]!.open).toBe(true);
    expect(week.workedMs).toBe(2.5 * 3_600_000);
  });

  it("clips an overnight shift to the end of its start day", () => {
    const night = shift({
      start: at(28, 22),
      end: at(29, 6),
      overnight: true,
      netMs: 8 * 3_600_000,
    });
    const week = buildHoursWeek({
      shifts: [night],
      now: at(29, 12),
      mondayKey: "2026-09-28",
      todayKey: "2026-09-29",
      planned: [],
    });
    const monday = week.days.find((day) => day.key === "2026-09-28")!;
    const bar = monday.work[0]!;
    expect(bar.startPct + bar.widthPct).toBeCloseTo(100, 5);
  });
});

describe("parseWeekParam", () => {
  const current = "2026-09-28";

  it("accepts a past Monday", () => {
    expect(parseWeekParam("2026-09-21", current)).toBe("2026-09-21");
  });

  it("accepts the current Monday", () => {
    expect(parseWeekParam("2026-09-28", current)).toBe(current);
  });

  it("falls back for a day that is not a Monday", () => {
    expect(parseWeekParam("2026-09-22", current)).toBe(current);
  });

  it("falls back for garbage and impossible dates", () => {
    expect(parseWeekParam("abc", current)).toBe(current);
    expect(parseWeekParam("2026-9-21", current)).toBe(current);
    expect(parseWeekParam("2026-02-30", current)).toBe(current);
  });

  it("falls back for a future week", () => {
    expect(parseWeekParam("2026-10-05", current)).toBe(current);
  });

  it("falls back when missing", () => {
    expect(parseWeekParam(undefined, current)).toBe(current);
  });
});
