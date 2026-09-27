import { describe, expect, it } from "vitest";

import { brusselsDayKey } from "./brussels-day-key";

describe("brusselsDayKey", () => {
  it("returns the winter (CET, UTC+1) local day", () => {
    // 2026-01-15T23:30:00Z is 2026-01-16T00:30 in Brussels.
    expect(brusselsDayKey(Date.UTC(2026, 0, 15, 23, 30))).toBe("2026-01-16");
  });

  it("returns the summer (CEST, UTC+2) local day", () => {
    // 2026-06-15T21:30:00Z is 2026-06-15T23:30 in Brussels.
    expect(brusselsDayKey(Date.UTC(2026, 5, 15, 21, 30))).toBe("2026-06-15");
    // One hour later it has rolled into the next Brussels day.
    expect(brusselsDayKey(Date.UTC(2026, 5, 15, 22, 30))).toBe("2026-06-16");
  });
});
