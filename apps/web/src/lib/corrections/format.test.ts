import { describe, expect, it } from "vitest";

import { formatBelgianDateTime, toBrusselsLocalInput } from "@/lib/corrections/format";

describe("Brussels correction formatting", () => {
  it("preserves factual seconds and microseconds when prefilling either endpoint", () => {
    expect(toBrusselsLocalInput("2026-02-10T08:15:12.123456+00:00")).toBe(
      "10/02/2026 09:15:12.123456",
    );
    expect(toBrusselsLocalInput("2026-02-10T08:15:00.000001Z")).toBe(
      "10/02/2026 09:15:00.000001",
    );
  });
  it("formats ordinary instants through Europe/Brussels", () => {
    expect(toBrusselsLocalInput("2026-02-10T08:15:00.000Z")).toBe("10/02/2026 09:15");
    expect(formatBelgianDateTime("2026-02-10T08:15:00.000Z")).toContain("09:15");
  });

  it("keeps Brussels local midnight on correct calendar day", () => {
    expect(toBrusselsLocalInput("2026-01-14T23:00:00.000Z")).toBe("15/01/2026 00:00");
  });

  it("formats overnight interval endpoints independently", () => {
    expect(toBrusselsLocalInput("2026-08-11T21:30:00.000Z")).toBe("11/08/2026 23:30");
    expect(toBrusselsLocalInput("2026-08-11T23:00:00.000Z")).toBe("12/08/2026 01:00");
  });

  it("skips nonexistent spring wall times", () => {
    expect(toBrusselsLocalInput("2026-03-29T00:30:00.000Z")).toBe("29/03/2026 01:30");
    expect(toBrusselsLocalInput("2026-03-29T01:30:00.000Z")).toBe("29/03/2026 03:30");
  });

  it("shows both autumn instants as repeated local time", () => {
    expect(toBrusselsLocalInput("2026-10-25T00:30:00.000Z")).toBe("25/10/2026 02:30");
    expect(toBrusselsLocalInput("2026-10-25T01:30:00.000Z")).toBe("25/10/2026 02:30");
  });
});
