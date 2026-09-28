import { describe, expect, it } from "vitest";

import { countWorkingDaysUntil, isLeadTimeShort, nextMonday } from "./lead-time";

describe("countWorkingDaysUntil", () => {
  it("counts Mon-Fri strictly after today, up to and including validFrom", () => {
    // 2026-09-28 is a Monday.
    expect(countWorkingDaysUntil("2026-09-28", "2026-10-07")).toBe(7);
  });

  it("excludes weekends", () => {
    // Fri 2026-10-02 -> next Mon 2026-10-05: only the Monday counts.
    expect(countWorkingDaysUntil("2026-10-02", "2026-10-05")).toBe(1);
  });

  it("is zero when validFrom is today or earlier", () => {
    expect(countWorkingDaysUntil("2026-09-28", "2026-09-28")).toBe(0);
    expect(countWorkingDaysUntil("2026-09-28", "2026-09-20")).toBe(0);
  });
});

describe("isLeadTimeShort", () => {
  it("warns when fewer than 7 working days remain", () => {
    expect(isLeadTimeShort("2026-09-28", "2026-09-29")).toBe(true);
  });

  it("doesn't warn at exactly 7 working days", () => {
    expect(isLeadTimeShort("2026-09-28", "2026-10-07")).toBe(false);
  });
});

describe("nextMonday", () => {
  it("is always strictly after today, even on a Monday", () => {
    expect(nextMonday("2026-09-28")).toBe("2026-10-05");
  });

  it("finds the coming Monday from mid-week", () => {
    expect(nextMonday("2026-09-30")).toBe("2026-10-05");
  });

  it("finds the coming Monday from a Sunday", () => {
    expect(nextMonday("2026-10-04")).toBe("2026-10-05");
  });
});
