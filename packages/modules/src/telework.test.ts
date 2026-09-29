import { describe, expect, it } from "vitest";

import { telework } from "./telework";
import { at, input, shift } from "./test-support";

describe("telework", () => {
  it("counts home and site shifts per month, this month first", () => {
    const counters = telework.counters(
      input({
        period: {
          from: "2026-01-01",
          to: "2026-09-29",
          now: at("2026-09-29", "18:00"),
        },
        shifts: [
          shift("2026-09-01", "09:00", "17:00", { workLocation: "home" }),
          shift("2026-09-02", "09:00", "17:00", { workLocation: "site" }),
          shift("2026-09-03", "09:00", "17:00", { workLocation: "site" }),
          shift("2026-09-04", "09:00", "17:00"), // not asked: not counted
          shift("2026-07-10", "09:00", "17:00", { workLocation: "home" }),
          shift("2026-03-10", "09:00", "17:00", { workLocation: "home" }),
          shift("2026-02-10", "09:00", "17:00", { workLocation: "home" }),
        ],
      }),
    );
    expect(counters.map((counter) => counter.label.values?.["month"])).toEqual([
      { month: "2026-09" },
      { month: "2026-07" },
      { month: "2026-03" },
    ]);
    expect(counters[0]?.value).toEqual({
      key: "modules.telework.monthValue",
      values: { home: 1, site: 2 },
    });
  });

  it("always shows this month, even without shifts, and crosses a new year", () => {
    const counters = telework.counters(
      input({
        period: {
          from: "2025-12-01",
          to: "2026-01-15",
          now: at("2026-01-15", "12:00"),
        },
        shifts: [shift("2025-12-15", "09:00", "17:00", { workLocation: "home" })],
      }),
    );
    expect(counters.map((counter) => counter.id)).toEqual([
      "telework.2026-01",
      "telework.2025-12",
    ]);
    expect(counters[0]?.value?.values).toEqual({ home: 0, site: 0 });
  });

  it("exports the day's home and site shifts", () => {
    expect(
      telework.exportValues({
        day: "2026-09-01",
        shifts: [
          shift("2026-09-01", "08:00", "12:00", { workLocation: "home" }),
          shift("2026-09-01", "13:00", "17:00", { workLocation: "site" }),
        ],
        planned: [],
        config: {},
        data: null,
        yearToDateNetMs: null,
      }),
    ).toEqual({ home_shifts: 1, site_shifts: 1 });
  });
});
