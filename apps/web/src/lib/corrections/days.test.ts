import { describe, expect, it } from "vitest";

import type { ClockEvent, ClockEventType } from "@cloxa/domain";

import { addDays, correctionDays } from "./days";

// 2026-09-28 is a Monday; Brussels is UTC+2 (CEST).
const at = (day: number, hour: number, minute: number) =>
  Date.UTC(2026, 8, day, hour - 2, minute);

let counter = 0;
function event(type: ClockEventType, occurredAt: number): ClockEvent {
  counter += 1;
  return {
    id: `e${counter}`,
    type,
    occurredAt,
    employeeId: "emp",
    siteId: "site",
    source: "app",
  };
}

const EVENTS: ClockEvent[] = [
  event("clock_in", at(25, 8, 2)),
  event("break_start", at(25, 12, 0)),
  event("break_end", at(25, 12, 30)),
  event("clock_out", at(25, 16, 31)),
  event("clock_in", at(25, 18, 0)),
  event("clock_out", at(25, 19, 0)),
  event("clock_in", at(28, 8, 0)),
];
const NOW = at(28, 11, 0);

describe("addDays", () => {
  it("steps over month ends and DST changes by the calendar", () => {
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(addDays("2026-10-26", -1)).toBe("2026-10-25");
  });
});

describe("correctionDays", () => {
  it("lists the last 14 days, newest first, with plain labels", () => {
    const days = correctionDays({ events: EVENTS, now: NOW });
    expect(days).toHaveLength(14);
    expect(days.map((day) => day.key).slice(0, 4)).toEqual([
      "2026-09-28",
      "2026-09-27",
      "2026-09-26",
      "2026-09-25",
    ]);
    expect(days[0]!.label).toBe("Vandaag");
    expect(days[1]!.label).toBe("Gisteren");
    expect(days[3]!.label).toBe("vr 25 sep");
    expect(days[3]!.longLabel).toBe("vrijdag 25 september");
  });

  it("summarises worked time per day, counting an open shift up to now", () => {
    const days = correctionDays({ events: EVENTS, now: NOW });
    expect(days[0]!.summary).toBe("08:00–nog bezig · 3 u");
    expect(days[1]!.summary).toBe("Geen uren");
    expect(days[3]!.summary).toBe("08:02–16:31, 18:00–19:00 · 8 u 59 min");
  });

  it("offers the day's events, or only the asked shift's", () => {
    const all = correctionDays({ events: EVENTS, now: NOW });
    expect(all[3]!.targets).toHaveLength(6);

    const one = correctionDays({
      events: EVENTS,
      now: NOW,
      preselected: "2026-09-25",
      shiftStart: at(25, 18, 0),
    });
    expect(one[3]!.targets.map((target) => target.type)).toEqual([
      "clock_in",
      "clock_out",
    ]);
  });

  it("lists a night shift's events after midnight, labelled with their day", () => {
    const night = [
      event("clock_in", at(25, 21, 36)),
      event("break_start", at(26, 0, 30)),
      event("break_end", at(26, 0, 50)),
      event("clock_out", at(26, 5, 12)),
    ];
    const days = correctionDays({ events: night, now: at(28, 11, 0) });
    const friday = days.find((day) => day.key === "2026-09-25")!;
    expect(friday.targets.map((target) => target.type)).toEqual([
      "clock_in",
      "break_start",
      "break_end",
      "clock_out",
    ]);
    expect(friday.targets.map((target) => target.dayLabel)).toEqual([
      undefined,
      "za 26 sep",
      "za 26 sep",
      "za 26 sep",
    ]);
    // The tail is not offered again on the day it ended.
    expect(days.find((day) => day.key === "2026-09-26")!.targets).toEqual([]);

    const asked = correctionDays({
      events: night,
      now: at(28, 11, 0),
      preselected: "2026-09-25",
      shiftStart: at(25, 21, 36),
    });
    expect(asked.find((day) => day.key === "2026-09-25")!.targets).toHaveLength(4);
  });

  it("keeps a night shift together over the October DST change", () => {
    // Sat 24 Oct 22:00 CEST (20:00Z) to Sun 25 Oct 06:00 CET (05:00Z): nine hours.
    const night = [
      event("clock_in", Date.UTC(2026, 9, 24, 20, 0)),
      event("clock_out", Date.UTC(2026, 9, 25, 5, 0)),
    ];
    const days = correctionDays({ events: night, now: Date.UTC(2026, 9, 26, 10, 0) });
    const saturday = days.find((day) => day.key === "2026-10-24")!;
    expect(saturday.targets.map((target) => target.occurredAtIso)).toEqual([
      "2026-10-24T20:00:00.000Z",
      "2026-10-25T05:00:00.000Z",
    ]);
    expect(saturday.targets[1]!.dayLabel).toBe("zo 25 okt");
    expect(days.find((day) => day.key === "2026-10-25")!.targets).toEqual([]);
  });

  it("adds a preselected day older than 14 days", () => {
    const days = correctionDays({ events: [], now: NOW, preselected: "2026-09-01" });
    expect(days).toHaveLength(15);
    expect(days[14]!.key).toBe("2026-09-01");
  });
});
