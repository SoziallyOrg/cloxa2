import { describe, expect, it } from "vitest";

import type { Shift } from "@cloxa/domain";

import { brusselsWeekRange, weekTotalMs } from "./week-total";

// Monday 2026-09-28 09:14 local (CEST, UTC+2).
const NOW = Date.UTC(2026, 8, 28, 7, 14, 0);

function shift(partial: Partial<Shift>): Shift {
  return {
    start: NOW,
    end: NOW,
    breaks: [],
    grossMs: 0,
    breakMs: 0,
    netMs: 0,
    open: false,
    openBreak: false,
    overnight: false,
    edited: false,
    hasOffline: false,
    ...partial,
  };
}

describe("brusselsWeekRange", () => {
  it("spans Monday 00:00 to next Monday 00:00, local", () => {
    const { start, end } = brusselsWeekRange(NOW);
    expect(new Date(start).toISOString()).toBe("2026-09-27T22:00:00.000Z"); // Mon 00:00 CEST
    expect(new Date(end).toISOString()).toBe("2026-10-04T22:00:00.000Z"); // next Mon 00:00 CEST
  });

  it("finds the same week from any weekday", () => {
    const sunday = Date.UTC(2026, 9, 4, 12, 0, 0); // 2026-10-04, still that week's Sunday
    expect(brusselsWeekRange(sunday)).toEqual(brusselsWeekRange(NOW));
  });
});

describe("weekTotalMs", () => {
  it("sums closed shifts within the current week", () => {
    const shifts = [
      shift({ start: NOW - 3_600_000, netMs: 4 * 3_600_000 }), // Monday, same week
      shift({ start: NOW + 2 * 86_400_000, netMs: 3 * 3_600_000 }), // Wednesday, same week
    ];
    expect(weekTotalMs(shifts, NOW)).toBe(7 * 3_600_000);
  });

  it("ignores shifts outside the current week", () => {
    const lastWeek = shift({ start: NOW - 8 * 86_400_000, netMs: 5 * 3_600_000 });
    expect(weekTotalMs([lastWeek], NOW)).toBe(0);
  });

  it("measures an open shift, minus an open break, up to now", () => {
    const openShift = shift({
      start: NOW - 3 * 3_600_000,
      end: null,
      open: true,
      breaks: [{ start: NOW - 3_600_000, end: null }],
    });
    // 3h worked minus a 1h ongoing break = 2h.
    expect(weekTotalMs([openShift], NOW)).toBe(2 * 3_600_000);
  });
});
