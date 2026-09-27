import { describe, expect, it } from "vitest";

import { deriveShiftState } from "./shift-state";

describe("deriveShiftState", () => {
  it("starts off with no events", () => {
    const result = deriveShiftState([]);
    expect(result).toEqual({ ok: true, state: "off" });
  });

  it("moves through a full valid shift", () => {
    const result = deriveShiftState([
      { type: "clock_in" },
      { type: "break_start" },
      { type: "break_end" },
      { type: "clock_out" },
    ]);
    expect(result).toEqual({ ok: true, state: "off" });
  });

  it("reports working after a clock_in", () => {
    const result = deriveShiftState([{ type: "clock_in" }]);
    expect(result).toEqual({ ok: true, state: "working" });
  });

  it("reports on_break after a break_start", () => {
    const result = deriveShiftState([{ type: "clock_in" }, { type: "break_start" }]);
    expect(result).toEqual({ ok: true, state: "on_break" });
  });

  it("rejects a break_start before clock_in", () => {
    const result = deriveShiftState([{ type: "break_start" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.index).toBe(0);
      expect(result.error).toContain("break_start");
    }
  });

  it("rejects a double clock_in", () => {
    const result = deriveShiftState([{ type: "clock_in" }, { type: "clock_in" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.index).toBe(1);
    }
  });

  it("rejects clock_out while on break", () => {
    const result = deriveShiftState([
      { type: "clock_in" },
      { type: "break_start" },
      { type: "clock_out" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.index).toBe(2);
    }
  });

  it("rejects break_end without an open break", () => {
    const result = deriveShiftState([{ type: "clock_in" }, { type: "break_end" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.index).toBe(1);
    }
  });
});
