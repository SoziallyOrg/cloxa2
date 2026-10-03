import { describe, expect, it } from "vitest";

import { deriveShifts } from "./shifts";
import { makeEvent } from "./test-support";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe("deriveShifts", () => {
  it("returns an empty array for empty input", () => {
    expect(deriveShifts([])).toEqual([]);
  });

  it("derives a normal day with one break", () => {
    const start = Date.UTC(2026, 5, 1, 9, 0); // 2026-06-01T09:00Z
    const breakStart = start + 3 * HOUR;
    const breakEnd = breakStart + 30 * MINUTE;
    const end = start + 8 * HOUR;

    const shifts = deriveShifts([
      makeEvent({ id: "1", type: "clock_in", occurredAt: start }),
      makeEvent({ id: "2", type: "break_start", occurredAt: breakStart }),
      makeEvent({ id: "3", type: "break_end", occurredAt: breakEnd }),
      makeEvent({ id: "4", type: "clock_out", occurredAt: end }),
    ]);

    expect(shifts).toEqual([
      {
        start,
        end,
        breaks: [{ start: breakStart, end: breakEnd }],
        grossMs: 8 * HOUR,
        breakMs: 30 * MINUTE,
        netMs: 8 * HOUR - 30 * MINUTE,
        open: false,
        openBreak: false,
        overnight: false,
        edited: false,
        hasOffline: false,
        offlineSkewMs: null,
      },
    ]);
  });

  it("derives a day with two breaks", () => {
    const start = Date.UTC(2026, 5, 1, 9, 0);
    const b1s = start + 2 * HOUR;
    const b1e = b1s + 15 * MINUTE;
    const b2s = start + 5 * HOUR;
    const b2e = b2s + 30 * MINUTE;
    const end = start + 8 * HOUR;

    const [shift] = deriveShifts([
      makeEvent({ id: "1", type: "clock_in", occurredAt: start }),
      makeEvent({ id: "2", type: "break_start", occurredAt: b1s }),
      makeEvent({ id: "3", type: "break_end", occurredAt: b1e }),
      makeEvent({ id: "4", type: "break_start", occurredAt: b2s }),
      makeEvent({ id: "5", type: "break_end", occurredAt: b2e }),
      makeEvent({ id: "6", type: "clock_out", occurredAt: end }),
    ]);

    expect(shift?.breaks).toEqual([
      { start: b1s, end: b1e },
      { start: b2s, end: b2e },
    ]);
    expect(shift?.breakMs).toBe(45 * MINUTE);
    expect(shift?.grossMs).toBe(8 * HOUR);
    expect(shift?.netMs).toBe(8 * HOUR - 45 * MINUTE);
  });

  it("derives an open shift with no further events", () => {
    const start = Date.UTC(2026, 5, 1, 9, 0);

    const [shift] = deriveShifts([
      makeEvent({ id: "1", type: "clock_in", occurredAt: start }),
    ]);

    expect(shift).toEqual({
      start,
      end: null,
      breaks: [],
      grossMs: 0,
      breakMs: 0,
      netMs: 0,
      open: true,
      openBreak: false,
      overnight: false,
      edited: false,
      hasOffline: false,
      offlineSkewMs: null,
    });
  });

  it("derives an open shift resumed after a closed break", () => {
    const start = Date.UTC(2026, 5, 1, 9, 0);
    const breakStart = start + HOUR;
    const breakEnd = breakStart + 20 * MINUTE;

    const [shift] = deriveShifts([
      makeEvent({ id: "1", type: "clock_in", occurredAt: start }),
      makeEvent({ id: "2", type: "break_start", occurredAt: breakStart }),
      makeEvent({ id: "3", type: "break_end", occurredAt: breakEnd }),
    ]);

    expect(shift?.open).toBe(true);
    expect(shift?.openBreak).toBe(false);
    expect(shift?.end).toBeNull();
    expect(shift?.grossMs).toBe(breakEnd - start);
    expect(shift?.breakMs).toBe(20 * MINUTE);
    expect(shift?.netMs).toBe(breakEnd - start - 20 * MINUTE);
  });

  it("derives an open break", () => {
    const start = Date.UTC(2026, 5, 1, 9, 0);
    const breakStart = start + HOUR;

    const [shift] = deriveShifts([
      makeEvent({ id: "1", type: "clock_in", occurredAt: start }),
      makeEvent({ id: "2", type: "break_start", occurredAt: breakStart }),
    ]);

    expect(shift?.open).toBe(true);
    expect(shift?.openBreak).toBe(true);
    expect(shift?.breaks).toEqual([{ start: breakStart, end: null }]);
    expect(shift?.grossMs).toBe(breakStart - start);
    expect(shift?.breakMs).toBe(0);
    expect(shift?.netMs).toBe(breakStart - start);
  });

  it("derives one shift for an overnight shift crossing Brussels midnight", () => {
    // Local Brussels 23:00 -> 01:00 next day (CEST, UTC+2, no DST transition).
    const start = Date.UTC(2026, 5, 15, 21, 0); // 2026-06-15T23:00 Brussels
    const end = Date.UTC(2026, 5, 15, 23, 0); // 2026-06-16T01:00 Brussels

    const shifts = deriveShifts([
      makeEvent({ id: "1", type: "clock_in", occurredAt: start }),
      makeEvent({ id: "2", type: "clock_out", occurredAt: end }),
    ]);

    expect(shifts).toHaveLength(1);
    expect(shifts[0]?.overnight).toBe(true);
    expect(shifts[0]?.grossMs).toBe(2 * HOUR);
  });

  it("flags a shift edited when any event has source correction", () => {
    const start = Date.UTC(2026, 5, 1, 9, 0);
    const end = start + 4 * HOUR;

    const [shift] = deriveShifts([
      makeEvent({ id: "1", type: "clock_in", occurredAt: start }),
      makeEvent({
        id: "2",
        type: "clock_out",
        occurredAt: end,
        source: "correction",
        correctionId: "corr-1",
      }),
    ]);

    expect(shift?.edited).toBe(true);
  });

  it("does not flag a shift edited when no event is a correction", () => {
    const start = Date.UTC(2026, 5, 1, 9, 0);
    const end = start + 4 * HOUR;

    const [shift] = deriveShifts([
      makeEvent({ id: "1", type: "clock_in", occurredAt: start }),
      makeEvent({ id: "2", type: "clock_out", occurredAt: end }),
    ]);

    expect(shift?.edited).toBe(false);
  });

  it("computes real elapsed time across the Brussels spring-forward night (2027-03-28)", () => {
    // 01:30 CET -> 04:30 CEST wall-clock reads +3h, real elapsed is +2h
    // because 02:00-03:00 local does not exist that night.
    const start = Date.UTC(2027, 2, 28, 0, 30);
    const end = Date.UTC(2027, 2, 28, 2, 30);

    const [shift] = deriveShifts([
      makeEvent({ id: "1", type: "clock_in", occurredAt: start }),
      makeEvent({ id: "2", type: "clock_out", occurredAt: end }),
    ]);

    expect(shift?.grossMs).toBe(2 * HOUR);
    expect(shift?.netMs).toBe(2 * HOUR);
    expect(shift?.netMs).toBe(120 * MINUTE);
  });

  it("computes real elapsed time across the Brussels fall-back night (2026-10-25)", () => {
    // Local wall-clock reads 02:00 -> 03:00 (looks like +1h) but 02:00-03:00
    // local happens twice, so real elapsed is +2h.
    const start = Date.UTC(2026, 9, 25, 0, 0);
    const end = Date.UTC(2026, 9, 25, 2, 0);

    const [shift] = deriveShifts([
      makeEvent({ id: "1", type: "clock_in", occurredAt: start }),
      makeEvent({ id: "2", type: "clock_out", occurredAt: end }),
    ]);

    expect(shift?.grossMs).toBe(2 * HOUR);
    expect(shift?.netMs).toBe(2 * HOUR);
    expect(shift?.netMs).toBe(120 * MINUTE);
  });

  it("ignores a break_start with no preceding clock_in (invalid sequence)", () => {
    const shifts = deriveShifts([
      makeEvent({
        id: "1",
        type: "break_start",
        occurredAt: Date.UTC(2026, 5, 1, 9, 0),
      }),
    ]);
    expect(shifts).toEqual([]);
  });

  it("ignores a break_end with no open break", () => {
    const start = Date.UTC(2026, 5, 1, 9, 0);
    const shifts = deriveShifts([
      makeEvent({ id: "1", type: "clock_in", occurredAt: start }),
      makeEvent({ id: "2", type: "break_end", occurredAt: start + HOUR }),
    ]);
    expect(shifts).toHaveLength(1);
    expect(shifts[0]?.breaks).toEqual([]);
    expect(shifts[0]?.open).toBe(true);
  });

  it("ignores a clock_out with no open shift", () => {
    const shifts = deriveShifts([
      makeEvent({ id: "1", type: "clock_out", occurredAt: Date.UTC(2026, 5, 1, 9, 0) }),
    ]);
    expect(shifts).toEqual([]);
  });
  it("flags a shift that contains an offline event", () => {
    const start = Date.UTC(2026, 5, 1, 9, 0);

    const [online, offline] = deriveShifts([
      makeEvent({ id: "1", type: "clock_in", occurredAt: start }),
      makeEvent({ id: "2", type: "clock_out", occurredAt: start + HOUR }),
      makeEvent({ id: "3", type: "clock_in", occurredAt: start + 2 * HOUR }),
      makeEvent({
        id: "4",
        type: "break_start",
        occurredAt: start + 3 * HOUR,
        offline: true,
      }),
    ]);

    expect(online?.hasOffline).toBe(false);
    expect(offline?.hasOffline).toBe(true);
    expect(offline?.edited).toBe(false);
  });

  it("keeps the longest offline sync delay of a shift", () => {
    const start = Date.UTC(2026, 5, 1, 9, 0);

    const [shift, noServerTime] = deriveShifts([
      makeEvent({
        id: "1",
        type: "clock_in",
        occurredAt: start,
        offline: true,
        serverAt: start + 10 * MINUTE,
      }),
      makeEvent({
        id: "2",
        type: "clock_out",
        occurredAt: start + HOUR,
        offline: true,
        serverAt: start + 3 * HOUR,
      }),
      makeEvent({
        id: "3",
        type: "clock_in",
        occurredAt: start + 4 * HOUR,
        offline: true,
      }),
    ]);

    expect(shift?.offlineSkewMs).toBe(2 * HOUR);
    expect(noServerTime?.hasOffline).toBe(true);
    expect(noServerTime?.offlineSkewMs).toBeNull();
  });

  it("takes the work location from the clock-in, and leaves it out when not asked", () => {
    const start = Date.UTC(2026, 5, 1, 9, 0);

    const [home, unasked] = deriveShifts([
      makeEvent({ id: "1", type: "clock_in", occurredAt: start, workLocation: "home" }),
      makeEvent({ id: "2", type: "clock_out", occurredAt: start + HOUR }),
      makeEvent({ id: "3", type: "clock_in", occurredAt: start + 2 * HOUR }),
    ]);

    expect(home?.workLocation).toBe("home");
    expect(unasked).not.toHaveProperty("workLocation");
  });
});
