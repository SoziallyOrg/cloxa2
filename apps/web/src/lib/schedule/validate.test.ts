import { describe, expect, it } from "vitest";

import { validateDayBlocks, validateScheduleForm } from "./validate";
import { EMPTY_SCHEDULE_FORM_STATE } from "./types";

describe("validateDayBlocks", () => {
  it("accepts no blocks", () => {
    expect(validateDayBlocks([])).toBeNull();
  });

  it("accepts sorted, non-overlapping blocks", () => {
    expect(
      validateDayBlocks([
        { start: "08:00", end: "12:00" },
        { start: "12:30", end: "16:30" },
      ]),
    ).toBeNull();
  });

  it("rejects more than 3 blocks", () => {
    expect(
      validateDayBlocks([
        { start: "06:00", end: "07:00" },
        { start: "07:00", end: "08:00" },
        { start: "08:00", end: "09:00" },
        { start: "09:00", end: "10:00" },
      ]),
    ).toBe("tooManyBlocks");
  });

  it("rejects a badly formatted time", () => {
    expect(validateDayBlocks([{ start: "8:00", end: "12:00" }])).toBe("invalidTime");
    expect(validateDayBlocks([{ start: "08:00", end: "25:00" }])).toBe("invalidTime");
  });

  it("rejects a zero-length block", () => {
    expect(validateDayBlocks([{ start: "08:00", end: "08:00" }])).toBe("zeroLength");
  });

  it("rejects overlapping blocks", () => {
    expect(
      validateDayBlocks([
        { start: "08:00", end: "12:00" },
        { start: "11:00", end: "13:00" },
      ]),
    ).toBe("overlap");
  });

  it("rejects unsorted blocks", () => {
    expect(
      validateDayBlocks([
        { start: "12:00", end: "16:00" },
        { start: "08:00", end: "10:00" },
      ]),
    ).toBe("overlap");
  });

  it("allows the last block to cross midnight", () => {
    expect(
      validateDayBlocks([
        { start: "08:00", end: "12:00" },
        { start: "22:00", end: "06:00" },
      ]),
    ).toBeNull();
  });

  it("rejects a block after one that already crossed midnight", () => {
    expect(
      validateDayBlocks([
        { start: "22:00", end: "06:00" },
        { start: "08:00", end: "10:00" },
      ]),
    ).toBe("afterOvernight");
  });

  it("accepts 24:00 as an end time", () => {
    expect(validateDayBlocks([{ start: "22:00", end: "24:00" }])).toBeNull();
  });

  it("rejects 24:00 as a start time", () => {
    expect(validateDayBlocks([{ start: "24:00", end: "08:00" }])).toBe("invalidTime");
  });
});

describe("validateScheduleForm", () => {
  it("is empty for a valid form", () => {
    expect(validateScheduleForm(EMPTY_SCHEDULE_FORM_STATE)).toEqual({});
  });

  it("reports only the days with an error", () => {
    const form = {
      ...EMPTY_SCHEDULE_FORM_STATE,
      mon: [{ start: "08:00", end: "08:00" }],
    };
    expect(validateScheduleForm(form)).toEqual({ mon: "zeroLength" });
  });
});
