import { describe, expect, it } from "vitest";

import { formatDurationMs, formatElapsed, statusTone, statusWord } from "./format";

describe("formatElapsed", () => {
  it("formats hours and minutes", () => {
    const since = Date.UTC(2026, 8, 28, 6, 0, 0);
    const now = Date.UTC(2026, 8, 28, 9, 12, 0);
    expect(formatElapsed(since, now)).toBe("3 u 12 min");
  });

  it("floors partial minutes", () => {
    const since = Date.UTC(2026, 8, 28, 6, 0, 0);
    const now = Date.UTC(2026, 8, 28, 6, 1, 59);
    expect(formatElapsed(since, now)).toBe("1 min");
  });

  it("never goes negative when now is before since", () => {
    const since = Date.UTC(2026, 8, 28, 9, 0, 0);
    const now = Date.UTC(2026, 8, 28, 6, 0, 0);
    expect(formatElapsed(since, now)).toBe("0 min");
  });

  it("omits zero minutes", () => {
    const since = Date.UTC(2026, 8, 28, 6, 0, 0);
    const now = Date.UTC(2026, 8, 28, 14, 0, 0);
    expect(formatElapsed(since, now)).toBe("8 u");
  });

  it("omits zero hours", () => {
    const since = Date.UTC(2026, 8, 28, 6, 0, 0);
    const now = Date.UTC(2026, 8, 28, 6, 30, 0);
    expect(formatElapsed(since, now)).toBe("30 min");
  });
});

describe("formatDurationMs", () => {
  it("matches formatElapsed's short forms", () => {
    expect(formatDurationMs(8 * 3_600_000)).toBe("8 u");
    expect(formatDurationMs(30 * 60_000)).toBe("30 min");
    expect(formatDurationMs(4 * 3_600_000 + 15 * 60_000)).toBe("4 u 15 min");
  });
});

describe("statusTone", () => {
  it("maps shift state to a status tone", () => {
    expect(statusTone("working")).toBe("working");
    expect(statusTone("on_break")).toBe("break");
    expect(statusTone("off")).toBe("off");
  });
});

describe("statusWord", () => {
  it("gives one word per state", () => {
    expect(statusWord("working")).toBe("Aan het werk");
    expect(statusWord("on_break")).toBe("Met pauze");
    expect(statusWord("off")).toBe("Niet aan het werk");
  });
});
