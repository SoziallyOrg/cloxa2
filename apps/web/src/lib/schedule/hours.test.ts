import { describe, expect, it } from "vitest";

import { formatWeeklyHours, weeklyMinutes } from "./hours";
import { EMPTY_SCHEDULE_FORM_STATE } from "./types";

describe("weeklyMinutes", () => {
  it("is zero for an empty schedule", () => {
    expect(weeklyMinutes(EMPTY_SCHEDULE_FORM_STATE)).toBe(0);
  });

  it("sums same-day blocks", () => {
    const form = {
      ...EMPTY_SCHEDULE_FORM_STATE,
      mon: [
        { start: "08:00", end: "12:00" },
        { start: "12:30", end: "16:30" },
      ],
    };
    // 4h + 4h = 8h = 480 min.
    expect(weeklyMinutes(form)).toBe(480);
  });

  it("sums across the whole week", () => {
    const form = {
      ...EMPTY_SCHEDULE_FORM_STATE,
      mon: [{ start: "08:00", end: "12:00" }],
      tue: [{ start: "08:00", end: "12:00" }],
      wed: [{ start: "08:00", end: "12:00" }],
      thu: [{ start: "08:00", end: "12:00" }],
      fri: [{ start: "08:00", end: "12:00" }],
    };
    expect(weeklyMinutes(form)).toBe(5 * 240);
  });

  it("counts an overnight block's minutes past midnight", () => {
    const form = {
      ...EMPTY_SCHEDULE_FORM_STATE,
      fri: [{ start: "22:00", end: "06:00" }],
    };
    // 22:00 -> 24:00 (2h) + 00:00 -> 06:00 (6h) = 8h = 480 min.
    expect(weeklyMinutes(form)).toBe(480);
  });

  it("treats 24:00 as end-of-day, not overnight", () => {
    const form = {
      ...EMPTY_SCHEDULE_FORM_STATE,
      fri: [{ start: "22:00", end: "24:00" }],
    };
    expect(weeklyMinutes(form)).toBe(120);
  });
});

describe("formatWeeklyHours", () => {
  it("omits minutes on the hour", () => {
    expect(formatWeeklyHours(480)).toBe("8 u");
  });

  it("shows minutes otherwise, zero-padded", () => {
    expect(formatWeeklyHours(485)).toBe("8 u 5 min");
    expect(formatWeeklyHours(510)).toBe("8 u 30 min");
  });
});
