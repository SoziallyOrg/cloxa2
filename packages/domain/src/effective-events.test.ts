import { describe, expect, it } from "vitest";

import { effectiveEvents } from "./effective-events";
import { makeEvent } from "./test-support";

describe("effectiveEvents", () => {
  it("returns an empty array for empty input", () => {
    expect(effectiveEvents([])).toEqual([]);
  });

  it("passes through a normal sequence unchanged, sorted by time", () => {
    const clockOut = makeEvent({ id: "b", type: "clock_out", occurredAt: 2000 });
    const clockIn = makeEvent({ id: "a", type: "clock_in", occurredAt: 1000 });
    const result = effectiveEvents([clockOut, clockIn]);
    expect(result.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("drops an event that another event supersedes", () => {
    const original = makeEvent({ id: "a", type: "clock_in", occurredAt: 1000 });
    const correction = makeEvent({
      id: "b",
      type: "clock_in",
      occurredAt: 900,
      source: "correction",
      supersedesEventId: "a",
      correctionId: "corr-1",
    });
    const result = effectiveEvents([original, correction]);
    expect(result.map((e) => e.id)).toEqual(["b"]);
  });

  it("drops a voided event and the void itself is never effective", () => {
    const original = makeEvent({ id: "a", type: "clock_in", occurredAt: 1000 });
    const voidEvent = makeEvent({
      id: "b",
      type: "void",
      occurredAt: 1100,
      source: "correction",
      supersedesEventId: "a",
    });
    const result = effectiveEvents([original, voidEvent]);
    expect(result).toEqual([]);
  });

  it("breaks ties on the same occurredAt by id", () => {
    const second = makeEvent({ id: "b", type: "break_start", occurredAt: 1000 });
    const first = makeEvent({ id: "a", type: "clock_in", occurredAt: 1000 });
    const result = effectiveEvents([second, first]);
    expect(result.map((e) => e.id)).toEqual(["a", "b"]);
  });
});
