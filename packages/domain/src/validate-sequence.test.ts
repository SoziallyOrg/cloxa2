import { describe, expect, it } from "vitest";

import { validateSequence } from "./validate-sequence";
import { makeEvent } from "./test-support";

describe("validateSequence", () => {
  it("returns no problems for empty input", () => {
    expect(validateSequence([])).toEqual([]);
  });

  it("returns no problems for a fully valid day", () => {
    const events = [
      makeEvent({ id: "1", type: "clock_in", occurredAt: 1000 }),
      makeEvent({ id: "2", type: "break_start", occurredAt: 2000 }),
      makeEvent({ id: "3", type: "break_end", occurredAt: 3000 }),
      makeEvent({ id: "4", type: "clock_out", occurredAt: 4000 }),
    ];
    expect(validateSequence(events)).toEqual([]);
  });

  it("collects every invalid transition, not just the first", () => {
    const events = [
      makeEvent({ id: "1", type: "break_end", occurredAt: 1000 }), // invalid: off
      makeEvent({ id: "2", type: "clock_in", occurredAt: 2000 }), // valid: off -> working
      makeEvent({ id: "3", type: "clock_in", occurredAt: 3000 }), // invalid: working
      makeEvent({ id: "4", type: "clock_out", occurredAt: 4000 }), // valid: working -> off
    ];
    const problems = validateSequence(events);
    expect(problems).toEqual([
      { index: 0, reason: expect.stringContaining("break_end") },
      { index: 2, reason: expect.stringContaining("clock_in") },
    ]);
  });
});
