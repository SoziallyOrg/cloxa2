import { describe, expect, it } from "vitest";
import {
  knownOccurrence,
  localTimeCandidates,
  minuteInput,
  preserveEndpoint,
} from "./local-time";
import { readableDuration } from "../time-clock/readable-duration";
import { workStatusLabel } from "../time-clock/work-status";

describe("minute editing without factual rounding", () => {
  it("distinguishes ordinary, repeated, nonexistent and invalid calendar input", () => {
    expect(localTimeCandidates("07/09/2026 09:30")).toEqual([
      Date.parse("2026-09-07T07:30Z"),
    ]);
    expect(localTimeCandidates("25/10/2026 02:30")).toEqual([
      Date.parse("2026-10-25T00:30Z"),
      Date.parse("2026-10-25T01:30Z"),
    ]);
    expect(localTimeCandidates("29/03/2026 02:30")).toEqual([]);
    expect(localTimeCandidates("31/02/2026 09:30")).toBeNull();
    expect(localTimeCandidates("07/09/2026 24:30")).toBeNull();
    expect(localTimeCandidates("07/09")).toBeNull();
  });
  it.each(["2026-10-25T00:30:19.123456Z", "2026-10-25T01:30:19.999999Z"])(
    "retains known occurrence and microseconds: %s",
    (instant) => {
      const result = preserveEndpoint(
        minuteInput(instant),
        knownOccurrence(instant),
        instant,
        instant,
      );
      expect(result.value).toContain(
        instant.includes("123456") ? ":19.123456" : ":19.999999",
      );
      expect(result.occurrence).toBe(instant.includes("T00") ? "earlier" : "later");
    },
  );
  it("editing one endpoint leaves the other exact; minute edits have no seconds", () => {
    const instant = "2026-09-07T07:00:59.123456Z";
    expect(preserveEndpoint("07/09/2026 09:00", "", instant, instant).value).toBe(
      "07/09/2026 09:00:59.123456",
    );
    expect(preserveEndpoint("07/09/2026 17:10", "", "", instant).value).toBe(
      "07/09/2026 17:10",
    );
  });
  it("refuses forged/stale originals, edited values and changed occurrence", () => {
    const instant = "2026-10-25T01:30:00.123456Z";
    expect(() =>
      preserveEndpoint("25/10/2026 02:30", "later", instant, undefined),
    ).toThrow();
    expect(() =>
      preserveEndpoint(
        "25/10/2026 02:30",
        "later",
        instant,
        instant.replace("123456", "123457"),
      ),
    ).toThrow();
    expect(() =>
      preserveEndpoint("25/10/2026 02:31", "later", instant, instant),
    ).toThrow();
    expect(() =>
      preserveEndpoint("25/10/2026 02:30", "earlier", instant, instant),
    ).toThrow();
  });
  it("does not call positive sub-minute durations zero", () => {
    expect(readableDuration(1n)).toBe("Minder dan 1 min");
    expect(readableDuration(59_999_999n)).toBe("Minder dan 1 min");
    expect(readableDuration(0n)).toBe("0 min");
    expect(readableDuration(27_000_000_000n)).toBe("7 u 30 min");
  });
});
describe("authoritative work-state copy", () => {
  it("separates work, break, stopped, unavailable and loading", () => {
    expect(
      workStatusLabel({ status: "working", currentStartedAt: "2026-09-07T07:00:00Z" }),
    ).toBe("Aan het werk · gestart om 09:00");
    expect(
      workStatusLabel({ status: "on_break", currentStartedAt: "2026-09-07T07:00:00Z" }),
    ).toBe("Met pauze");
    expect(workStatusLabel({ status: "not_working", currentStartedAt: null })).toBe(
      "Niet aan het werk",
    );
    expect(workStatusLabel(null)).toBe("Werkstatus niet beschikbaar");
    expect(workStatusLabel(null, true)).toBe("Werkstatus wordt gecontroleerd…");
  });
});
