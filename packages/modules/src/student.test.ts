import { describe, expect, it } from "vitest";

import { student } from "./student";
import { at, block, HOUR, input, shift } from "./test-support";

const period = { from: "2026-01-01", to: "2026-09-29", now: at("2026-09-29", "18:00") };

describe("student", () => {
  it("counts the calendar year's hours against 650", () => {
    const [year] = student.counters(
      input({
        period,
        shifts: [
          shift("2025-12-31", "09:00", "17:00"), // last year: not counted
          shift("2026-02-03", "09:00", "17:00", { breakMinutes: 30 }),
          shift("2026-09-28", "10:00", "14:00"),
        ],
      }),
    );
    expect(year?.display).toBe("figure");
    expect(year?.label).toEqual({
      key: "modules.student.yearLabel",
      values: { year: 2026 },
    });
    expect(year?.value?.values?.["value"]).toEqual({ durationMs: 11.5 * HOUR });
    expect(year?.progress?.max).toBe(650 * HOUR);
    expect(year?.lines?.[0]).toEqual({
      key: "modules.student.remaining",
      values: { remaining: { durationMs: (650 - 11.5) * HOUR } },
    });
  });

  it("measures a shift still running up to now", () => {
    const [year] = student.counters(
      input({ period, shifts: [shift("2026-09-29", "14:00", null)] }),
    );
    expect(year?.value?.values?.["value"]).toEqual({ durationMs: 4 * HOUR });
  });

  it("adds hours elsewhere read this year, and leaves an older reading out", () => {
    const shifts = [shift("2026-03-02", "09:00", "13:00")];
    const [same] = student.counters(
      input({
        period,
        shifts,
        data: { hours_elsewhere: 100.5, checked_on: "2026-06-01" },
      }),
    );
    expect(same?.value?.values?.["value"]).toEqual({ durationMs: 104.5 * HOUR });
    expect(same?.lines?.[1]).toEqual({
      key: "modules.student.elsewhere",
      values: { hours: { durationMs: 100.5 * HOUR }, date: { day: "2026-06-01" } },
    });

    const [stale] = student.counters(
      input({
        period,
        shifts,
        data: { hours_elsewhere: 300, checked_on: "2025-11-20" },
      }),
    );
    expect(stale?.value?.values?.["value"]).toEqual({ durationMs: 4 * HOUR });
    expect(stale?.lines?.at(-1)).toEqual({
      key: "modules.student.elsewhereStale",
      values: { year: 2025 },
    });
  });

  it("says how far over the contingent, and hints to check Student@work", () => {
    const data = { hours_elsewhere: 648, checked_on: "2026-09-01" };
    const shifts = [shift("2026-09-28", "09:00", "13:00")];
    const [year] = student.counters(input({ period, shifts, data }));
    expect(year?.lines?.[0]).toEqual({
      key: "modules.student.over",
      values: { over: { durationMs: 2 * HOUR } },
    });
    expect(student.hints(input({ period, shifts, data }))).toEqual([
      {
        id: "student.over",
        tone: "attention",
        message: { key: "modules.student.hintOver", values: { year: 2026 } },
      },
    ]);
  });

  it("hints when 50 hours or less are left, and stays quiet otherwise", () => {
    const low = student.hints(
      input({ period, data: { hours_elsewhere: 610, checked_on: "2026-09-01" } }),
    );
    expect(low[0]?.message).toEqual({
      key: "modules.student.hintLow",
      values: { remaining: { durationMs: 40 * HOUR } },
    });
    expect(student.hints(input({ period }))).toEqual([]);
  });

  it("shows planned against worked per quarter, up to the current quarter", () => {
    const [, ...quarters] = student.counters(
      input({
        period,
        shifts: [shift("2026-08-03", "09:00", "12:00")],
        planned: [
          block("2026-01-05", "09:00", "13:00"),
          block("2026-08-03", "09:00", "13:00"),
          block("2026-09-30", "09:00", "11:00"), // later in Q3: still Q3's plan
          block("2026-10-05", "09:00", "17:00"), // Q4: not shown yet
        ],
      }),
    );
    expect(quarters.map((counter) => counter.id)).toEqual([
      "student.quarter.1",
      "student.quarter.2",
      "student.quarter.3",
    ]);
    expect(quarters[0]?.label.values).toEqual({ quarter: 1 });
    expect(quarters[0]?.value?.values).toEqual({
      planned: { durationMs: 4 * HOUR },
      worked: { durationMs: 0 },
    });
    expect(quarters[2]?.value?.values).toEqual({
      planned: { durationMs: 6 * HOUR },
      worked: { durationMs: 3 * HOUR },
    });
  });

  it("validates its fields: hours and date together, two decimals at most", () => {
    const fields = student.employeeFields!;
    expect(fields.safeParse({}).success).toBe(true);
    expect(
      fields.safeParse({ hours_elsewhere: 12.25, checked_on: "2026-09-01" }).success,
    ).toBe(true);
    expect(fields.safeParse({ hours_elsewhere: 12 }).success).toBe(false);
    expect(
      fields.safeParse({ hours_elsewhere: 1.234, checked_on: "2026-09-01" }).success,
    ).toBe(false);
    expect(fields.safeParse({ other: 1 }).success).toBe(false);
  });

  it("exports the quarter and the year-to-date hours", () => {
    expect(
      student.exportValues({
        day: "2026-08-03",
        shifts: [],
        planned: [],
        config: {},
        data: null,
        yearToDateNetMs: 42 * HOUR,
      }),
    ).toEqual({ quarter: "2026-Q3", year_to_date_net_ms: 42 * HOUR });
  });
});
