import { describe, expect, it } from "vitest";

import type { ClockEventType } from "./clock-event";
import { deriveShiftState } from "./shift-state";

function types(...types: ClockEventType[]) {
  return types.map((type) => ({ type }));
}

describe("deriveShiftState", () => {
  it("starts off with no events", () => {
    const result = deriveShiftState([]);
    expect(result).toEqual({ ok: true, state: "off" });
  });

  it("moves through a full valid shift", () => {
    const result = deriveShiftState(
      types("clock_in", "break_start", "break_end", "clock_out"),
    );
    expect(result).toEqual({ ok: true, state: "off" });
  });

  it("reports working after a clock_in", () => {
    const result = deriveShiftState(types("clock_in"));
    expect(result).toEqual({ ok: true, state: "working" });
  });

  it("reports on_break after a break_start", () => {
    const result = deriveShiftState(types("clock_in", "break_start"));
    expect(result).toEqual({ ok: true, state: "on_break" });
  });

  it("handles two breaks in one shift", () => {
    const result = deriveShiftState(
      types(
        "clock_in",
        "break_start",
        "break_end",
        "break_start",
        "break_end",
        "clock_out",
      ),
    );
    expect(result).toEqual({ ok: true, state: "off" });
  });

  const invalidTransitions: {
    state: string;
    events: ClockEventType[];
    badIndex: number;
  }[] = [
    { state: "off", events: ["break_start"], badIndex: 0 },
    { state: "off", events: ["break_end"], badIndex: 0 },
    { state: "off", events: ["clock_out"], badIndex: 0 },
    { state: "working", events: ["clock_in", "clock_in"], badIndex: 1 },
    { state: "working", events: ["clock_in", "break_end"], badIndex: 1 },
    { state: "on_break", events: ["clock_in", "break_start", "clock_in"], badIndex: 2 },
    {
      state: "on_break",
      events: ["clock_in", "break_start", "break_start"],
      badIndex: 2,
    },
    {
      state: "on_break",
      events: ["clock_in", "break_start", "clock_out"],
      badIndex: 2,
    },
  ];

  it.each(invalidTransitions)(
    "rejects $events.$badIndex while $state",
    ({ events, badIndex }) => {
      const result = deriveShiftState(types(...events));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.index).toBe(badIndex);
      }
    },
  );

  it("rejects a void event reaching the state machine directly", () => {
    const result = deriveShiftState(types("void"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.index).toBe(0);
    }
  });
});
