import { describe, expect, it } from "vitest";

import { compareWithPlan, flexi } from "./flexi";
import { at, block, HOUR, input, shift } from "./test-support";

const period = { from: "2026-09-21", to: "2026-09-29", now: at("2026-09-29", "18:00") };

describe("flexi", () => {
  it("lists the days with a shift, newest first, with the range and net", () => {
    const counters = flexi.counters(
      input({
        period,
        shifts: [
          shift("2026-09-22", "08:02", "12:31"),
          shift("2026-09-28", "17:00", "22:15", { breakMinutes: 15 }),
          shift("2026-09-10", "08:00", "12:00"), // before the period
        ],
      }),
    );
    expect(counters.map((counter) => counter.id)).toEqual([
      "flexi.day.2026-09-28",
      "flexi.day.2026-09-22",
    ]);
    expect(counters[0]?.value).toEqual({
      key: "modules.flexi.dayValue",
      values: { range: "17:00–22:15", net: { durationMs: 5 * HOUR } },
    });
  });

  it("shows a running shift as still going", () => {
    const [today] = flexi.counters(
      input({ period, shifts: [shift("2026-09-29", "16:00", null)] }),
    );
    expect(today?.value).toEqual({
      key: "modules.flexi.dayValueOpen",
      values: { start: { time: at("2026-09-29", "16:00") } },
    });
  });

  it("notes a start or end more than 15 minutes off the plan, as a check", () => {
    const planned = [
      block("2026-09-22", "08:00", "12:00"),
      block("2026-09-23", "08:00", "12:00"),
      block("2026-09-24", "08:00", "12:00"),
    ];
    const shifts = [
      shift("2026-09-22", "08:15", "12:15"), // exactly 15 minutes: fine
      shift("2026-09-23", "08:16", "12:00"), // the start is off
      shift("2026-09-24", "07:30", "13:00"), // both are off
    ];
    const hints = flexi.hints(input({ period, planned, shifts }));
    expect(hints.map((hint) => hint.message.values?.["part"])).toEqual([
      "both",
      "start",
    ]);
    expect(hints[0]).toEqual({
      id: "flexi.differs.2026-09-24",
      tone: "attention",
      message: {
        key: "modules.flexi.hintDiffersManager",
        values: { day: { day: "2026-09-24" }, part: "both", planned: "08:00–12:00" },
      },
    });
    const employee = flexi.hints(
      input({ period, planned, shifts, audience: "employee" }),
    );
    expect(employee[0]?.message.key).toBe("modules.flexi.hintDiffersEmployee");
  });

  it("compares nothing without a plan, and ignores the end of a running shift", () => {
    expect(compareWithPlan([shift("2026-09-22", "08:00", "12:00")], [])).toBeNull();
    const running = compareWithPlan(
      [shift("2026-09-29", "08:05", null)],
      [block("2026-09-29", "08:00", "12:00")],
    );
    expect(running?.part).toBeNull();
  });

  it("exports the planned start and end, and whether the day differs", () => {
    const day = {
      day: "2026-09-23",
      config: {},
      data: null,
      yearToDateNetMs: null,
    };
    expect(
      flexi.exportValues({
        ...day,
        shifts: [shift("2026-09-23", "08:40", "12:00")],
        planned: [block("2026-09-23", "08:00", "12:00")],
      }),
    ).toEqual({
      planned_start_local: "08:00",
      planned_end_local: "12:00",
      differs_from_planned: true,
    });
    expect(flexi.exportValues({ ...day, shifts: [], planned: [] })).toEqual({
      planned_start_local: null,
      planned_end_local: null,
      differs_from_planned: null,
    });
  });
});
