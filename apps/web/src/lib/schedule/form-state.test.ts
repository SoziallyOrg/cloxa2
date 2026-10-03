import { describe, expect, it } from "vitest";

import type { SchedulePattern } from "@cloxa/db";

import { formStateToPattern, patternToFormState } from "./form-state";
import { EMPTY_SCHEDULE_FORM_STATE } from "./types";

describe("patternToFormState", () => {
  it("returns the empty state for null", () => {
    expect(patternToFormState(null)).toEqual(EMPTY_SCHEDULE_FORM_STATE);
  });

  it("fills only the days present in the pattern", () => {
    const pattern = {
      mon: [{ start: "08:00", end: "12:00" }],
      wed: [{ start: "09:00", end: "13:00" }],
    } as SchedulePattern;
    const form = patternToFormState(pattern);
    expect(form.mon).toEqual([{ start: "08:00", end: "12:00" }]);
    expect(form.wed).toEqual([{ start: "09:00", end: "13:00" }]);
    expect(form.tue).toEqual([]);
    expect(form.sun).toEqual([]);
  });

  it("shows a stored 24:00 end as 00:00, the input control's own midnight", () => {
    const pattern = { fri: [{ start: "22:00", end: "24:00" }] } as SchedulePattern;
    expect(patternToFormState(pattern).fri).toEqual([{ start: "22:00", end: "00:00" }]);
  });
});

describe("formStateToPattern", () => {
  it("omits days without blocks", () => {
    const pattern = formStateToPattern({
      ...EMPTY_SCHEDULE_FORM_STATE,
      mon: [{ start: "08:00", end: "12:00" }],
    });
    expect(pattern).toEqual({ mon: [{ start: "08:00", end: "12:00" }] });
    expect(pattern).not.toHaveProperty("tue");
  });

  it("never carries exceptions (the editor doesn't edit them)", () => {
    const pattern = formStateToPattern(EMPTY_SCHEDULE_FORM_STATE);
    expect(pattern).not.toHaveProperty("exceptions");
  });

  it("round-trips through patternToFormState", () => {
    const form = {
      ...EMPTY_SCHEDULE_FORM_STATE,
      mon: [
        { start: "08:00", end: "12:00" },
        { start: "12:30", end: "16:30" },
      ],
    };
    expect(patternToFormState(formStateToPattern(form))).toEqual(form);
  });
});
