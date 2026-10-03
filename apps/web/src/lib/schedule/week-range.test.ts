import { describe, expect, it } from "vitest";

import { mondayOfWeek, nextWeekRange, thisWeekRange } from "./week-range";

describe("mondayOfWeek", () => {
  it("is itself on a Monday", () => {
    expect(mondayOfWeek("2026-09-28")).toBe("2026-09-28");
  });

  it("goes back to Monday from mid-week", () => {
    expect(mondayOfWeek("2026-10-01")).toBe("2026-09-28");
  });

  it("goes back to Monday from Sunday", () => {
    expect(mondayOfWeek("2026-10-04")).toBe("2026-09-28");
  });
});

describe("thisWeekRange", () => {
  it("spans Monday to Sunday", () => {
    expect(thisWeekRange("2026-10-01")).toEqual({
      from: "2026-09-28",
      to: "2026-10-04",
    });
  });
});

describe("nextWeekRange", () => {
  it("is the following Monday-Sunday week", () => {
    expect(nextWeekRange("2026-10-01")).toEqual({
      from: "2026-10-05",
      to: "2026-10-11",
    });
  });
});
