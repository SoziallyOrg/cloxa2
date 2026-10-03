import { describe, expect, it } from "vitest";

import {
  copyMondayToWorkdays,
  emptyTemplate,
  fullTimeTemplate,
  partTimeMorningTemplate,
} from "./templates";
import { EMPTY_SCHEDULE_FORM_STATE } from "./types";

describe("fullTimeTemplate", () => {
  it("sets two blocks ma-vr with a 30 minute break, weekend empty", () => {
    const form = fullTimeTemplate();
    for (const day of ["mon", "tue", "wed", "thu", "fri"] as const) {
      expect(form[day]).toEqual([
        { start: "08:00", end: "12:00" },
        { start: "12:30", end: "16:30" },
      ]);
    }
    expect(form.sat).toEqual([]);
    expect(form.sun).toEqual([]);
  });
});

describe("partTimeMorningTemplate", () => {
  it("sets one morning block ma-vr", () => {
    const form = partTimeMorningTemplate();
    expect(form.mon).toEqual([{ start: "08:00", end: "12:00" }]);
    expect(form.fri).toEqual([{ start: "08:00", end: "12:00" }]);
    expect(form.sat).toEqual([]);
  });
});

describe("emptyTemplate", () => {
  it("has no blocks on any day", () => {
    expect(emptyTemplate()).toEqual(EMPTY_SCHEDULE_FORM_STATE);
  });
});

describe("copyMondayToWorkdays", () => {
  it("overwrites tue-fri with Monday's blocks, leaves weekend alone", () => {
    const form = {
      ...EMPTY_SCHEDULE_FORM_STATE,
      mon: [{ start: "08:00", end: "12:00" }],
      tue: [{ start: "09:00", end: "10:00" }],
      sat: [{ start: "10:00", end: "11:00" }],
    };
    const result = copyMondayToWorkdays(form);
    expect(result.tue).toEqual([{ start: "08:00", end: "12:00" }]);
    expect(result.fri).toEqual([{ start: "08:00", end: "12:00" }]);
    expect(result.sat).toEqual([{ start: "10:00", end: "11:00" }]);
  });

  it("copies a fresh array so mutating the copy doesn't touch Monday's", () => {
    const form = {
      ...EMPTY_SCHEDULE_FORM_STATE,
      mon: [{ start: "08:00", end: "12:00" }],
    };
    const result = copyMondayToWorkdays(form);
    expect(result.tue).not.toBe(result.mon);
  });
});
