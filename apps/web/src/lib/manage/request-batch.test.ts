import { describe, expect, it } from "vitest";

import {
  DAY_MS,
  earliestTargetMs,
  eventsInWindow,
  windowsByEmployee,
} from "./request-batch";

const iso = (ms: number) => new Date(ms).toISOString();
const BASE = Date.UTC(2026, 8, 20, 12);

describe("earliestTargetMs", () => {
  const known = new Map([
    ["a", iso(BASE + 5000)],
    ["b", iso(BASE)],
  ]);

  it("picks the earliest known target", () => {
    expect(earliestTargetMs(["a", "b", "zzz"], known)).toBe(BASE);
  });

  it("is null when no target is known", () => {
    expect(earliestTargetMs(["zzz"], known)).toBeNull();
    expect(earliestTargetMs([], known)).toBeNull();
  });
});

describe("windowsByEmployee", () => {
  it("covers every request of one employee and keeps employees apart", () => {
    const spans = windowsByEmployee([
      { id: "1", employeeId: "e1", anchorMs: BASE },
      { id: "2", employeeId: "e1", anchorMs: BASE + 5 * DAY_MS },
      { id: "3", employeeId: "e2", anchorMs: BASE + 9 * DAY_MS },
    ]);
    expect(spans.get("e1")).toEqual({ fromMs: BASE - DAY_MS, toMs: BASE + 6 * DAY_MS });
    expect(spans.get("e2")).toEqual({
      fromMs: BASE + 8 * DAY_MS,
      toMs: BASE + 10 * DAY_MS,
    });
  });
});

describe("eventsInWindow", () => {
  const events = [
    { employee_id: "e1", occurred_at: iso(BASE - DAY_MS - 1) },
    { employee_id: "e1", occurred_at: iso(BASE - DAY_MS) },
    { employee_id: "e2", occurred_at: iso(BASE) },
    { employee_id: "e1", occurred_at: iso(BASE + DAY_MS) },
    { employee_id: "e1", occurred_at: iso(BASE + DAY_MS + 1) },
  ];

  it("keeps the employee's events within the inclusive window", () => {
    const got = eventsInWindow(events, { employeeId: "e1", anchorMs: BASE });
    expect(got).toEqual([events[1], events[3]]);
  });
});
