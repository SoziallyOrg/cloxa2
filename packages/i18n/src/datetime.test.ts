import { describe, expect, it } from "vitest";

import { formatBrusselsDate, formatBrusselsTime } from "./datetime";

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
