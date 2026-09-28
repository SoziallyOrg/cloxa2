import { describe, expect, it } from "vitest";

import {
  addDays,
  brusselsDayStart,
  brusselsIsoLocal,
  monthPeriod,
  periodLength,
  periodQuickPicks,
  recentMonths,
} from "./brussels";

describe("periodQuickPicks", () => {
  it("uses the Brussels calendar, not UTC, just after local midnight", () => {
    // 2026-09-30 22:30Z is already 1 October 00:30 in Brussels.
    const picks = periodQuickPicks(Date.parse("2026-09-30T22:30:00Z"));
    expect(picks.thisMonth).toEqual({ from: "2026-10-01", to: "2026-10-01" });
    expect(picks.previousMonth).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("wraps January back to December of the previous year", () => {
    const picks = periodQuickPicks(Date.parse("2027-01-15T10:00:00Z"));
    expect(picks.previousMonth).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(picks.thisMonth).toEqual({ from: "2027-01-01", to: "2027-01-15" });
  });

  it("knows leap years", () => {
    const picks = periodQuickPicks(Date.parse("2028-03-10T10:00:00Z"));
    expect(picks.previousMonth).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});

describe("monthPeriod and recentMonths", () => {
  it("cuts the running month at today", () => {
    expect(monthPeriod("2026-09", "2026-09-17")).toEqual({
      from: "2026-09-01",
      to: "2026-09-17",
    });
    expect(monthPeriod("2026-08", "2026-09-17")).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });

  it("lists months newest first", () => {
    expect(recentMonths(Date.parse("2026-01-31T23:30:00Z"), 3)).toEqual([
      "2026-02",
      "2026-01",
      "2025-12",
    ]);
  });
});

describe("day arithmetic", () => {
  it("adds calendar days and measures inclusive periods", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(periodLength({ from: "2026-09-01", to: "2026-09-30" })).toBe(30);
  });

  it("starts Brussels days at local midnight, whatever the offset", () => {
    expect(brusselsDayStart("2026-07-01")).toBe(Date.parse("2026-06-30T22:00:00Z"));
    expect(brusselsDayStart("2026-12-01")).toBe(Date.parse("2026-11-30T23:00:00Z"));
    // The fall-back day lasts 25 hours.
    expect(brusselsDayStart("2026-10-26") - brusselsDayStart("2026-10-25")).toBe(
      25 * 3600_000,
    );
  });
});

describe("brusselsIsoLocal", () => {
  it("writes local time with its offset", () => {
    expect(brusselsIsoLocal(Date.parse("2026-07-01T06:00:00Z"))).toBe(
      "2026-07-01T08:00:00+02:00",
    );
    expect(brusselsIsoLocal(Date.parse("2026-12-01T07:00:00Z"))).toBe(
      "2026-12-01T08:00:00+01:00",
    );
  });

  it("keeps the doubled fall-back hour apart", () => {
    expect(brusselsIsoLocal(Date.parse("2026-10-25T00:30:00Z"))).toBe(
      "2026-10-25T02:30:00+02:00",
    );
    expect(brusselsIsoLocal(Date.parse("2026-10-25T01:30:00Z"))).toBe(
      "2026-10-25T02:30:00+01:00",
    );
  });

  it("writes midnight as 00, not 24", () => {
    expect(brusselsIsoLocal(Date.parse("2026-11-30T23:00:00Z"))).toBe(
      "2026-12-01T00:00:00+01:00",
    );
  });
});
