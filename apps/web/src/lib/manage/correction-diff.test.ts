import { describe, expect, it } from "vitest";

import type { ClockEvent } from "@cloxa/domain";

import { buildCorrectionDiff, type CorrectionRequestLike } from "./correction-diff";

function event(
  overrides: Partial<ClockEvent> & Pick<ClockEvent, "id" | "type" | "occurredAt">,
): ClockEvent {
  return {
    employeeId: "emp-1",
    siteId: "site-1",
    source: "app",
    ...overrides,
  };
}

const EFFECTIVE_LOG: ClockEvent[] = [
  event({
    id: "clock-in-1",
    type: "clock_in",
    occurredAt: Date.parse("2026-09-28T08:00:00+02:00"),
  }),
  event({
    id: "clock-out-1",
    type: "clock_out",
    occurredAt: Date.parse("2026-09-28T16:00:00+02:00"),
  }),
];

describe("buildCorrectionDiff", () => {
  it("adjust: shows before/after times and the resulting shift", () => {
    const request: CorrectionRequestLike = {
      kind: "adjust",
      targetEventIds: ["clock-in-1"],
      proposed: {
        events: [
          { target_event_id: "clock-in-1", occurred_at: "2026-09-28T07:30:00+02:00" },
        ],
      },
    };
    const diff = buildCorrectionDiff(request, EFFECTIVE_LOG);

    expect(diff.changes).toEqual([
      {
        type: "clock_in",
        beforeIso: new Date(Date.parse("2026-09-28T08:00:00+02:00")).toISOString(),
        afterIso: "2026-09-28T07:30:00+02:00",
      },
    ]);
    expect(diff.beforeShifts).toHaveLength(1);
    expect(diff.beforeShifts[0]!.start).toBe(Date.parse("2026-09-28T08:00:00+02:00"));
    expect(diff.afterShifts).toHaveLength(1);
    expect(diff.afterShifts[0]!.start).toBe(Date.parse("2026-09-28T07:30:00+02:00"));
  });

  it("add: a missed break shows only an after time", () => {
    const request: CorrectionRequestLike = {
      kind: "add",
      targetEventIds: [],
      proposed: {
        events: [
          {
            type: "break_start",
            occurred_at: "2026-09-28T12:00:00+02:00",
            site_id: "site-1",
          },
          {
            type: "break_end",
            occurred_at: "2026-09-28T12:30:00+02:00",
            site_id: "site-1",
          },
        ],
      },
    };
    const diff = buildCorrectionDiff(request, EFFECTIVE_LOG);

    expect(diff.changes).toEqual([
      { type: "break_start", beforeIso: null, afterIso: "2026-09-28T12:00:00+02:00" },
      { type: "break_end", beforeIso: null, afterIso: "2026-09-28T12:30:00+02:00" },
    ]);
    expect(diff.afterShifts[0]!.breaks).toHaveLength(1);
  });

  it("remove: shows only a before time and drops the event from the resulting shift", () => {
    const request: CorrectionRequestLike = {
      kind: "remove",
      targetEventIds: ["clock-out-1"],
      proposed: {},
    };
    const diff = buildCorrectionDiff(request, EFFECTIVE_LOG);

    expect(diff.changes).toEqual([
      {
        type: "clock_out",
        beforeIso: new Date(Date.parse("2026-09-28T16:00:00+02:00")).toISOString(),
        afterIso: null,
      },
    ]);
    expect(diff.afterShifts[0]!.open).toBe(true);
  });
});
