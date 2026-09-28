import { describe, expect, it } from "vitest";

import { blocksForOpenShift, plannedEndForOpenShift } from "./open-shift";

const at = (iso: string) => Date.parse(iso);

describe("open shift blocks", () => {
  const night = {
    start: at("2026-09-28T21:30:00+02:00"),
    end: at("2026-09-29T06:00:00+02:00"),
  };
  const day = {
    start: at("2026-09-29T08:00:00+02:00"),
    end: at("2026-09-29T16:30:00+02:00"),
  };

  it("finds yesterday's overnight block for a night shift", () => {
    const startedAt = at("2026-09-28T21:30:00+02:00");
    expect(plannedEndForOpenShift(startedAt, [night, day])).toBe(night.end);
  });

  it("finds today's block for a day shift, not last night's", () => {
    const startedAt = at("2026-09-29T08:05:00+02:00");
    expect(blocksForOpenShift(startedAt, [night, day])).toEqual([day]);
  });

  it("is null without a schedule", () => {
    expect(plannedEndForOpenShift(at("2026-09-29T08:05:00+02:00"), [])).toBeNull();
  });
});
