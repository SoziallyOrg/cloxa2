import { describe, expect, it } from "vitest";

import type { Shift } from "@cloxa/domain";

import { clockBarModel, DEFAULT_RING_MS, formatBarTime } from "./clock-bar";

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

describe("formatBarTime", () => {
  it("writes hours and zero-padded minutes", () => {
    expect(formatBarTime(4 * 3_600_000 + 12 * 60_000)).toBe("4u 12");
    expect(formatBarTime(3 * 3_600_000)).toBe("3u 00");
    expect(formatBarTime(5 * 60_000)).toBe("0u 05");
    expect(formatBarTime(-1)).toBe("0u 00");
  });
});

describe("clockBarModel", () => {
  it("is hidden when not clocked in", () => {
    expect(
      clockBarModel({
        state: "off",
        since: null,
        now: at(9, 0),
        todayShifts: [],
        pending: [],
      }),
    ).toBeNull();
  });

  it("working: 'Jij werkt', the worked time, Pauze + Stop werk", () => {
    const model = clockBarModel({
      state: "working",
      since: at(8, 2),
      now: at(12, 14),
      todayShifts: [openShift(at(8, 2))],
      pending: [],
    });
    expect(model).toMatchObject({
      kind: "working",
      title: "Jij werkt",
      time: "4u 12",
      secondaryAction: "startBreak",
      secondaryLabel: "Pauze",
      stopLabel: "Stop werk",
    });
    expect(model?.progress).toBeCloseTo((4 * 60 + 12) / (8 * 60), 5);
  });

  it("on break: 'Je bent op pauze', the break so far, Verder werken + Stop werk", () => {
    const model = clockBarModel({
      state: "on_break",
      since: at(8, 0),
      now: at(12, 30),
      todayShifts: [openShift(at(8, 0), [{ start: at(12, 0), end: null }])],
      pending: [],
    });
    expect(model).toMatchObject({
      kind: "on_break",
      title: "Je bent op pauze",
      time: "0u 30",
      secondaryAction: "stopBreak",
      secondaryLabel: "Verder werken",
      stopLabel: "Stop werk",
    });
    // The ring keeps showing the worked time (4u), not the break.
    expect(model?.progress).toBeCloseTo(0.5, 5);
  });

  it("measures against the plan when known, and never exceeds full", () => {
    const model = clockBarModel({
      state: "working",
      since: at(8, 0),
      now: at(18, 0),
      todayShifts: [openShift(at(8, 0))],
      pending: [],
      plannedMs: 4 * 3_600_000,
    });
    expect(model?.progress).toBe(1);
    expect(DEFAULT_RING_MS).toBe(8 * 3_600_000);
  });
});
