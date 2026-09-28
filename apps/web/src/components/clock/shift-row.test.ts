import { describe, expect, it } from "vitest";

import type { Shift } from "@cloxa/domain";

import { formatShiftRow } from "./shift-row";

function shift(overrides: Partial<Shift> = {}): Shift {
  return {
    start: Date.UTC(2026, 8, 28, 6, 0, 0),
    end: Date.UTC(2026, 8, 28, 10, 30, 0),
    breaks: [],
    grossMs: 4.5 * 60 * 60 * 1000,
    breakMs: 30 * 60 * 1000,
    netMs: 4 * 60 * 60 * 1000,
    open: false,
    openBreak: false,
    overnight: false,
    edited: false,
    hasOffline: false,
    offlineSkewMs: null,
    ...overrides,
  };
}

describe("formatShiftRow", () => {
  it("formats a closed shift", () => {
    expect(formatShiftRow(shift())).toEqual({
      date: "ma 28 sep",
      range: "08:00–12:30",
      pause: "30 min",
      net: "4 u",
      edited: false,
      offline: false,
      offlineSkew: null,
    });
  });

  it("marks an open shift without an end time", () => {
    const row = formatShiftRow(shift({ end: null, open: true }));
    expect(row.range).toBe("08:00–nog bezig");
  });

  it("carries the edited flag through", () => {
    expect(formatShiftRow(shift({ edited: true })).edited).toBe(true);
  });

  it("carries the offline flag and the sync delay through", () => {
    const row = formatShiftRow(
      shift({ hasOffline: true, offlineSkewMs: 130 * 60_000 }),
    );
    expect(row.offline).toBe(true);
    expect(row.offlineSkew).toBe("2 u 10 min");
  });
});
