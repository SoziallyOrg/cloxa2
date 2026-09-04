import { describe, expect, it } from "vitest";
import { factualTotals, formatExactDuration, parseBreaks } from "./breaks";
import { parseTimeClockView } from "./model";
import { toBrusselsLocalInput } from "@/lib/corrections/format";

const pause = {
  id: "10000000-0000-4000-8000-000000000001",
  started_at: "2026-03-29T00:59:59.123456Z",
  ended_at: "2026-03-29T01:00:00.123457Z",
  version: 2,
};
describe("live break facts", () => {
  it("subtracts completed microseconds across Brussels spring transition", () => {
    const totals = factualTotals(
      "2026-03-29T00:00:00.123456Z",
      "2026-03-29T02:00:00.123459Z",
      parseBreaks([pause])!,
    );
    expect(totals).toEqual({
      gross: 7200000003n,
      completedBreak: 1000001n,
      net: 7199000002n,
    });
    expect(formatExactDuration(totals.net!)).toBe("1 u 59 min 59,000002 s");
    expect(toBrusselsLocalInput(pause.started_at)).toBe("29/03/2026 01:59:59.123456");
    expect(toBrusselsLocalInput(pause.ended_at)).toBe("29/03/2026 03:00:00.123457");
  });
  it("does not invent an end for an open shift or break", () => {
    const breaks = parseBreaks([{ ...pause, ended_at: null, version: 1 }])!;
    expect(factualTotals(pause.started_at, null, breaks)).toEqual({
      gross: null,
      completedBreak: 0n,
      net: null,
    });
  });
  it.each([
    undefined,
    {},
    [{ ...pause, version: 0 }],
    [{ ...pause, ended_at: pause.started_at }],
    [{ ...pause, started_at: "infinity" }],
    [pause, pause],
    [pause, { ...pause, id: "20000000-0000-4000-8000-000000000001" }],
  ])("rejects missing, invalid, duplicate or overlapping break facts %#", (value) => {
    expect(parseBreaks(value)).toBeNull();
  });
  it.each([1, 3, 4])("reads effective revision version %s", (version) => {
    expect(parseBreaks([{ ...pause, version }])?.[0]?.version).toBe(version);
  });
  it("requires break state to match contained open fact", () => {
    const view = {
      current_started_at: "2026-03-29T00:00:00Z",
      status: "on_break",
      worksite_id: pause.id,
      server_time: "2026-03-29T01:00:00Z",
      timezone: "Europe/Brussels",
      entries: [
        {
          id: pause.id,
          worksite_id: pause.id,
          started_at: "2026-03-29T00:00:00Z",
          ended_at: null,
          breaks: [{ ...pause, ended_at: null, version: 1 }],
        },
      ],
    };
    expect(parseTimeClockView(view)?.status).toBe("on_break");
    expect(parseTimeClockView({ ...view, status: "working" })).toBeNull();
    expect(
      parseTimeClockView({
        ...view,
        entries: [{ ...view.entries[0], ended_at: pause.ended_at }],
      }),
    ).toBeNull();
  });
});
