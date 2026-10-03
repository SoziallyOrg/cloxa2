import { describe, expect, it } from "vitest";

import { requestChanges } from "./request-changes";

// Brussels is UTC+2 in September 2026.
const clockOut = { id: "e1", type: "clock_out", occurredAt: "2026-09-29T14:30:00Z" };

describe("requestChanges", () => {
  it("shows an added registration as 'geen' to the new time", () => {
    const result = requestChanges({
      kind: "add",
      proposed: {
        events: [
          { type: "clock_in", occurred_at: "2026-09-29T06:00:00Z", site_id: "s" },
        ],
      },
      targetEventIds: [],
      targetEvents: [],
    });
    expect(result.changes).toEqual([
      { typeLabel: "Begonnen met werken", was: "geen", willBe: "08:00" },
    ]);
    expect(result.dayLabel).toBe("di 29 sep");
  });

  it("shows an adjusted registration from the old to the new time", () => {
    const result = requestChanges({
      kind: "adjust",
      proposed: {
        events: [{ target_event_id: "e1", occurred_at: "2026-09-29T14:45:00Z" }],
      },
      targetEventIds: ["e1"],
      targetEvents: [clockOut],
    });
    expect(result.changes).toEqual([
      { typeLabel: "Gestopt met werken", was: "16:30", willBe: "16:45" },
    ]);
  });

  it("shows a removed registration as 'verwijderd'", () => {
    const result = requestChanges({
      kind: "remove",
      proposed: {},
      targetEventIds: ["e1"],
      targetEvents: [clockOut],
    });
    expect(result.changes).toEqual([
      { typeLabel: "Gestopt met werken", was: "16:30", willBe: "verwijderd" },
    ]);
  });

  it("skips what it cannot resolve instead of guessing", () => {
    expect(
      requestChanges({
        kind: "remove",
        proposed: null,
        targetEventIds: ["x"],
        targetEvents: [],
      }).changes,
    ).toEqual([]);
  });
});
