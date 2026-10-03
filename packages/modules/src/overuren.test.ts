import { describe, expect, it } from "vitest";

import { overuren, overurenThresholds } from "./overuren";
import { at, block, HOUR, input, shift } from "./test-support";

const period = { from: "2026-01-01", to: "2026-09-29", now: at("2026-09-29", "20:00") };

describe("overuren", () => {
  it("counts time above the plan, only on days with a plan", () => {
    const [year] = overuren.counters(
      input({
        period,
        planned: [
          block("2026-03-02", "09:00", "17:00"),
          block("2026-03-03", "09:00", "17:00"),
          block("2025-12-30", "09:00", "10:00"), // last year
        ],
        shifts: [
          shift("2026-03-02", "08:00", "18:30"), // 2 h 30 above
          shift("2026-03-03", "09:00", "15:00"), // under: counts 0, never negative
          shift("2026-03-07", "09:00", "17:00"), // no plan: not counted
          shift("2025-12-30", "09:00", "20:00"), // last year
        ],
      }),
    );
    expect(year?.value?.values?.["value"]).toEqual({ durationMs: 2.5 * HOUR });
    expect(year?.progress?.max).toBe(360 * HOUR);
    expect(year?.lines).toEqual([
      { key: "modules.overuren.thresholds", values: { first: 240, second: 360 } },
      { key: "modules.overuren.plannedDaysOnly" },
    ]);
  });

  it("uses 360/450 for horeca and falls back to the general limits", () => {
    expect(overurenThresholds({ sector: "horeca" })).toEqual([360, 450]);
    expect(overurenThresholds({})).toEqual([240, 360]);
    expect(overurenThresholds({ sector: "bouw" })).toEqual([240, 360]);
    expect(overurenThresholds(null)).toEqual([240, 360]);
  });

  it("hints at each threshold, calmly, without a verdict", () => {
    const planned = Array.from({ length: 100 }, (_, index) => {
      const day = new Date(Date.UTC(2026, 0, 5 + index)).toISOString().slice(0, 10);
      return block(day, "09:00", "10:00");
    });
    const long = (hoursAbove: number) =>
      planned.map((plan) => {
        const end = 10 + hoursAbove;
        return shift(plan.day, "09:00", `${String(end).padStart(2, "0")}:00`);
      });

    expect(overuren.hints(input({ period, planned, shifts: long(2) }))).toEqual([]);
    expect(overuren.hints(input({ period, planned, shifts: long(3) }))).toEqual([
      {
        id: "overuren.first",
        tone: "info",
        message: {
          key: "modules.overuren.hintAbove",
          values: { hours: 240, year: 2026 },
        },
      },
    ]);
    const [ceiling] = overuren.hints(input({ period, planned, shifts: long(4) }));
    expect(ceiling?.tone).toBe("attention");
    expect(ceiling?.message.values).toEqual({ hours: 360, year: 2026 });
    const [horeca] = overuren.hints(
      input({ period, planned, shifts: long(4), config: { sector: "horeca" } }),
    );
    expect(horeca?.message.values).toEqual({ hours: 360, year: 2026 });
  });

  it("exports the day's time above the plan, and nothing without a plan", () => {
    const base = { day: "2026-03-02", config: {}, data: null, yearToDateNetMs: null };
    expect(
      overuren.exportValues({
        ...base,
        shifts: [shift("2026-03-02", "08:00", "18:00")],
        planned: [block("2026-03-02", "09:00", "17:00")],
      }),
    ).toEqual({ above_planned_ms: 2 * HOUR });
    expect(
      overuren.exportValues({
        ...base,
        shifts: [shift("2026-03-02", "08:00", "18:00")],
        planned: [],
      }),
    ).toEqual({ above_planned_ms: null });
  });
});
