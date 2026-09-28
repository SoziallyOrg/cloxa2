import { describe, expect, it } from "vitest";

import { boardCounts, type BoardPerson } from "./board-counts";

const at = (iso: string) => Date.parse(iso);
const person = (overrides: Partial<BoardPerson>): BoardPerson => ({
  open: null,
  clockedToday: false,
  firstStartToday: null,
  ...overrides,
});

describe("boardCounts", () => {
  it("counts a night worker from yesterday as working, not as not started", () => {
    const now = at("2026-09-29T01:13:00+02:00");
    const counts = boardCounts(
      [
        person({ open: { onBreak: false } }),
        person({ open: { onBreak: true } }),
        // Day shift at 08:00: not due yet at 01:13.
        person({ firstStartToday: at("2026-09-29T08:00:00+02:00") }),
        person({}),
      ],
      now,
    );
    expect(counts).toEqual({ working: 1, onBreak: 1, notStarted: 0 });
  });

  it("counts not started only after the planned start, and never for the working", () => {
    const now = at("2026-09-29T08:30:00+02:00");
    const counts = boardCounts(
      [
        person({ firstStartToday: at("2026-09-29T08:00:00+02:00") }),
        person({ firstStartToday: at("2026-09-29T13:00:00+02:00") }),
        person({
          firstStartToday: at("2026-09-29T08:00:00+02:00"),
          clockedToday: true,
        }),
        person({
          firstStartToday: at("2026-09-29T08:00:00+02:00"),
          open: { onBreak: false },
        }),
      ],
      now,
    );
    expect(counts).toEqual({ working: 1, onBreak: 0, notStarted: 1 });
  });
});
