import { describe, expect, it } from "vitest";

import {
  brusselsLocalToInstant,
  formatBrusselsDate,
  formatBrusselsTime,
} from "./datetime";

describe("formatBrusselsTime", () => {
  it("formats winter time (CET, UTC+1)", () => {
    expect(formatBrusselsTime(new Date("2026-01-15T12:00:00Z"))).toBe("13:00");
  });

  it("formats summer time (CEST, UTC+2)", () => {
    expect(formatBrusselsTime(new Date("2026-07-15T12:00:00Z"))).toBe("14:00");
  });

  it("handles the spring-forward DST boundary (2026-03-29)", () => {
    // 00:59 UTC is still CET (01:59 local); the clock then jumps straight to
    // 03:00 CEST at 01:00 UTC, skipping the 02:00-03:00 local hour.
    expect(formatBrusselsTime(new Date("2026-03-29T00:59:00Z"))).toBe("01:59");
    expect(formatBrusselsTime(new Date("2026-03-29T01:00:00Z"))).toBe("03:00");
  });

  it("handles the autumn fall-back DST boundary (2026-10-25)", () => {
    // 00:59 UTC is still CEST (02:59 local); clocks fall back to 02:00 CET
    // at 01:00 UTC.
    expect(formatBrusselsTime(new Date("2026-10-25T00:59:00Z"))).toBe("02:59");
    expect(formatBrusselsTime(new Date("2026-10-25T01:00:00Z"))).toBe("02:00");
  });
});

describe("formatBrusselsDate", () => {
  it("formats a date in nl-BE long form", () => {
    expect(formatBrusselsDate(new Date("2026-09-27T10:00:00Z"))).toBe(
      "27 september 2026",
    );
  });
});

describe("brusselsLocalToInstant", () => {
  it("converts a winter (CET, UTC+1) local time", () => {
    expect(brusselsLocalToInstant("2026-01-15", "13:00").toISOString()).toBe(
      "2026-01-15T12:00:00.000Z",
    );
  });

  it("converts a summer (CEST, UTC+2) local time", () => {
    expect(brusselsLocalToInstant("2026-07-15", "14:00").toISOString()).toBe(
      "2026-07-15T12:00:00.000Z",
    );
  });

  it("moves a nonexistent spring-forward local time forward by the gap", () => {
    // 02:00-03:00 local doesn't exist on 2026-03-29: clocks jump from 01:59:59
    // CET straight to 03:00:00 CEST. 02:30 resolves as if shifted to 03:30 CEST.
    expect(brusselsLocalToInstant("2026-03-29", "02:30").toISOString()).toBe(
      "2026-03-29T01:30:00.000Z",
    );
  });

  it("resolves an ambiguous autumn fall-back local time to the later, standard-time instant", () => {
    // 02:00-03:00 local occurs twice on 2026-10-25: first as CEST (00:00Z-01:00Z
    // in UTC), then again as CET (01:00Z-02:00Z). The later, standard-time one wins.
    expect(brusselsLocalToInstant("2026-10-25", "02:30").toISOString()).toBe(
      "2026-10-25T01:30:00.000Z",
    );
  });
});
