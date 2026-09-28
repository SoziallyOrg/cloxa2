import { describe, expect, it } from "vitest";

import {
  attentionByEmployee,
  buildAttention,
  forgottenClockOuts,
  longBreaks,
  notStartedAttention,
  offlineDelayedAttention,
  offlineWeeklyAttention,
  pendingQuestionsAttention,
  type AttentionItem,
  type AttentionReason,
  type OpenShiftStatus,
  type ScheduledStart,
} from "./attention";

function shift(overrides: Partial<OpenShiftStatus>): OpenShiftStatus {
  return {
    employeeId: "emp-1",
    employeeName: "Jan Jansen",
    startedAt: Date.parse("2026-09-28T08:00:00+02:00"),
    openBreakStartedAt: null,
    plannedEnd: null,
    ...overrides,
  };
}

describe("forgottenClockOuts", () => {
  it("flags an open shift longer than 12h", () => {
    const now = Date.parse("2026-09-28T20:01:00+02:00");
    const result = forgottenClockOuts(
      [shift({ startedAt: Date.parse("2026-09-28T08:00:00+02:00") })],
      now,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.reason).toBe("forgotClockOut");
  });

  it("does not flag a shift within 12h on the same Brussels day", () => {
    const now = Date.parse("2026-09-28T19:00:00+02:00");
    const result = forgottenClockOuts(
      [shift({ startedAt: Date.parse("2026-09-28T08:00:00+02:00") })],
      now,
    );
    expect(result).toHaveLength(0);
  });

  it("does not flag a night shift that began yesterday and is within its plan", () => {
    // 21:30 yesterday, planned until 06:00, now 01:13.
    const now = Date.parse("2026-09-29T01:13:00+02:00");
    const result = forgottenClockOuts(
      [
        shift({
          startedAt: Date.parse("2026-09-28T21:30:00+02:00"),
          plannedEnd: Date.parse("2026-09-29T06:00:00+02:00"),
        }),
      ],
      now,
    );
    expect(result).toHaveLength(0);
  });

  it("does not flag a night shift without a schedule under 12h", () => {
    const now = Date.parse("2026-09-29T00:10:00+02:00");
    expect(
      forgottenClockOuts(
        [shift({ startedAt: Date.parse("2026-09-28T23:50:00+02:00") })],
        now,
      ),
    ).toHaveLength(0);
  });

  it("flags a real forgotten clock-out (over 12h) and names the duration", () => {
    const now = Date.parse("2026-09-29T10:30:00+02:00");
    const [item] = forgottenClockOuts(
      [shift({ startedAt: Date.parse("2026-09-28T21:30:00+02:00") })],
      now,
    );
    expect(item?.durationMs).toBe(13 * 3600 * 1000);
    expect(item?.plannedEnd).toBeUndefined();
  });

  it("flags an open shift more than 2h past its planned end, and names the plan", () => {
    const plannedEnd = Date.parse("2026-09-29T06:00:00+02:00");
    const startedAt = Date.parse("2026-09-28T21:30:00+02:00");
    expect(
      forgottenClockOuts(
        [shift({ startedAt, plannedEnd })],
        plannedEnd + 2 * 3600 * 1000,
      ),
    ).toHaveLength(0);
    const [item] = forgottenClockOuts(
      [shift({ startedAt, plannedEnd })],
      plannedEnd + 2 * 3600 * 1000 + 60_000,
    );
    expect(item?.plannedEnd).toBe(plannedEnd);
  });

  it("does not flag a day shift running an hour past its plan", () => {
    const now = Date.parse("2026-09-28T17:30:00+02:00");
    expect(
      forgottenClockOuts(
        [
          shift({
            startedAt: Date.parse("2026-09-28T08:00:00+02:00"),
            plannedEnd: Date.parse("2026-09-28T16:30:00+02:00"),
          }),
        ],
        now,
      ),
    ).toHaveLength(0);
  });

  it("is DST-safe across the October fallback boundary", () => {
    // 2026-10-25 is the Brussels DST fallback (CEST -> CET); the local day
    // is 25h long. A shift started at 08:00 the day before is still open at
    // 20:30 local the next day but under 12h has not passed by then.
    const startedAt = Date.parse("2026-10-24T08:00:00+02:00");
    const now = Date.parse("2026-10-24T19:00:00+02:00");
    expect(forgottenClockOuts([shift({ startedAt })], now)).toHaveLength(0);
  });
});

describe("longBreaks", () => {
  it("flags an open break over 60 minutes", () => {
    const now = Date.parse("2026-09-28T12:05:00+02:00");
    const openBreakStartedAt = Date.parse("2026-09-28T11:00:00+02:00");
    const result = longBreaks([shift({ openBreakStartedAt })], now);
    expect(result).toHaveLength(1);
    expect(result[0]!.reason).toBe("longBreak");
  });

  it("does not flag a break under 60 minutes", () => {
    const now = Date.parse("2026-09-28T11:30:00+02:00");
    const openBreakStartedAt = Date.parse("2026-09-28T11:00:00+02:00");
    expect(longBreaks([shift({ openBreakStartedAt })], now)).toHaveLength(0);
  });

  it("ignores shifts without an open break", () => {
    const now = Date.parse("2026-09-28T12:05:00+02:00");
    expect(longBreaks([shift({ openBreakStartedAt: null })], now)).toHaveLength(0);
  });
});

describe("notStartedAttention", () => {
  const scheduled: ScheduledStart[] = [
    {
      employeeId: "emp-2",
      employeeName: "Marie Peeters",
      startAt: Date.parse("2026-09-28T08:00:00+02:00"),
    },
  ];

  it("flags a scheduled start passed by more than 15 minutes with no clock_in", () => {
    const now = Date.parse("2026-09-28T08:16:00+02:00");
    const result = notStartedAttention(scheduled, new Set(), now);
    expect(result).toHaveLength(1);
    expect(result[0]!.reason).toBe("notStarted");
  });

  it("does not flag within the 15-minute grace period", () => {
    const now = Date.parse("2026-09-28T08:10:00+02:00");
    expect(notStartedAttention(scheduled, new Set(), now)).toHaveLength(0);
  });

  it("does not flag an employee who already clocked in", () => {
    const now = Date.parse("2026-09-28T08:16:00+02:00");
    expect(notStartedAttention(scheduled, new Set(["emp-2"]), now)).toHaveLength(0);
  });
});

describe("pendingQuestionsAttention", () => {
  it("returns nothing when there are no pending requests", () => {
    expect(pendingQuestionsAttention(0)).toEqual([]);
  });

  it("returns one summary item carrying the count", () => {
    const result = pendingQuestionsAttention(3);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ reason: "pendingQuestions", count: 3 });
  });
});

describe("offlineDelayedAttention", () => {
  const now = Date.parse("2026-09-28T12:00:00+02:00");
  const event = (occurred: string, server: string, employeeId = "emp-1") => ({
    employeeId,
    employeeName: "Jan Jansen",
    occurredAt: Date.parse(occurred),
    serverAt: Date.parse(server),
  });

  it("flags events synced today more than 5 minutes late, once per employee", () => {
    const result = offlineDelayedAttention(
      [
        event("2026-09-28T08:00:00+02:00", "2026-09-28T08:06:00+02:00"),
        event("2026-09-28T10:00:00+02:00", "2026-09-28T11:00:00+02:00"),
      ],
      now,
    );
    expect(result).toEqual([
      {
        id: "offline-emp-1",
        employeeId: "emp-1",
        employeeName: "Jan Jansen",
        reason: "offlineDelayed",
      },
    ]);
  });

  it("flags an event dated yesterday that was synced today", () => {
    expect(
      offlineDelayedAttention(
        [event("2026-09-27T16:00:00+02:00", "2026-09-28T07:00:00+02:00")],
        now,
      ).map((item) => item.reason),
    ).toEqual(["offlineDelayed"]);
  });

  it("ignores a delay of 5 minutes or less and events synced on other days", () => {
    expect(
      offlineDelayedAttention(
        [
          event("2026-09-28T08:00:00+02:00", "2026-09-28T08:05:00+02:00"),
          event("2026-09-26T08:00:00+02:00", "2026-09-27T08:00:00+02:00", "emp-2"),
        ],
        now,
      ),
    ).toEqual([]);
  });
});

describe("offlineWeeklyAttention", () => {
  const event = (employeeId: string) => ({
    employeeId,
    employeeName: employeeId === "emp-1" ? "Jan Jansen" : "Els Maes",
    occurredAt: 0,
    serverAt: 0,
  });

  it("lists employees with 3 or more offline events, with the count", () => {
    const result = offlineWeeklyAttention([
      event("emp-1"),
      event("emp-2"),
      event("emp-1"),
      event("emp-2"),
      event("emp-1"),
    ]);
    expect(result).toEqual([
      {
        id: "offline-week-emp-1",
        employeeId: "emp-1",
        employeeName: "Jan Jansen",
        reason: "offlineWeekly",
        count: 3,
      },
    ]);
  });
});

describe("buildAttention", () => {
  it("combines every rule in a stable order", () => {
    const now = Date.parse("2026-09-28T20:01:00+02:00");
    const result = buildAttention({
      openShifts: [shift({ startedAt: Date.parse("2026-09-28T08:00:00+02:00") })],
      scheduledStarts: [],
      clockedInEmployeeIds: new Set(),
      offlineEvents: [
        {
          employeeId: "emp-2",
          employeeName: "Els Maes",
          occurredAt: Date.parse("2026-09-28T09:00:00+02:00"),
          serverAt: Date.parse("2026-09-28T10:00:00+02:00"),
        },
      ],
      pendingCorrectionsCount: 2,
      now,
    });
    expect(result.map((item) => item.reason)).toEqual([
      "forgotClockOut",
      "offlineDelayed",
      "pendingQuestions",
    ]);
  });
});

describe("attentionByEmployee", () => {
  const item = (reason: AttentionReason, employeeId = "emp-1"): AttentionItem => ({
    id: `${reason}-${employeeId}`,
    employeeId,
    employeeName: "Jan Jansen",
    reason,
  });

  it("puts the most important issue first and counts the rest", () => {
    const result = attentionByEmployee([
      item("offlineWeekly"),
      item("offlineDelayed"),
      item("longBreak"),
    ]).get("emp-1");
    expect(result?.primary.reason).toBe("longBreak");
    expect(result?.items.map((entry) => entry.reason)).toEqual([
      "longBreak",
      "offlineDelayed",
      "offlineWeekly",
    ]);
    expect(result?.extra).toBe(2);
  });

  it("drops 'not started' when a clock-out was forgotten", () => {
    const result = attentionByEmployee([
      item("notStarted"),
      item("forgotClockOut"),
    ]).get("emp-1");
    expect(result?.items.map((entry) => entry.reason)).toEqual(["forgotClockOut"]);
    expect(result?.extra).toBe(0);
  });

  it("keeps 'not started' on its own", () => {
    const result = attentionByEmployee([item("notStarted")]).get("emp-1");
    expect(result?.primary.reason).toBe("notStarted");
  });

  it("groups per person and ignores the pending-questions summary", () => {
    const result = attentionByEmployee([
      item("longBreak", "emp-1"),
      item("notStarted", "emp-2"),
      ...pendingQuestionsAttention(2),
    ]);
    expect([...result.keys()].sort()).toEqual(["emp-1", "emp-2"]);
  });
});
