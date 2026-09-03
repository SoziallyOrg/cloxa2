import { describe, expect, it } from "vitest";

import {
  formatBelgianDate,
  formatBelgianTime,
  formatDuration,
} from "@/lib/time-clock/format";

describe("Belgian time-clock formatting", () => {
  it("skips from 01:30 to 03:30 at spring daylight-saving transition", () => {
    expect(formatBelgianTime("2026-03-29T00:30:00.000Z")).toBe("01:30");
    expect(formatBelgianTime("2026-03-29T01:30:00.000Z")).toBe("03:30");
  });

  it("renders both repeated autumn instants as local 02:30", () => {
    expect(formatBelgianTime("2026-10-25T00:30:00.000Z")).toBe("02:30");
    expect(formatBelgianTime("2026-10-25T01:30:00.000Z")).toBe("02:30");
  });

  it("uses Dutch Belgian calendar labels around local midnight", () => {
    expect(formatBelgianDate("2026-03-28T23:30:00.000Z")).toBe("zondag 29 maart");
  });

  it("calculates duration from absolute instants across DST changes", () => {
    expect(formatDuration("2026-03-29T00:30:00.000Z", "2026-03-29T01:30:00.000Z")).toBe(
      "1 u 00 min",
    );
    expect(formatDuration("2026-10-25T00:30:00.000Z", "2026-10-25T02:30:00.000Z")).toBe(
      "2 u 00 min",
    );
  });
});
