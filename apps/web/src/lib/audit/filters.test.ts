import { describe, expect, it } from "vitest";

import { parseAuditFilters } from "./filters";

describe("parseAuditFilters", () => {
  it("returns every-field-null for an empty query", () => {
    expect(parseAuditFilters({})).toEqual({
      from: null,
      to: null,
      category: null,
      actor: null,
      cursor: null,
    });
  });

  it("parses valid values", () => {
    expect(
      parseAuditFilters({
        from: "2026-01-01",
        to: "2026-01-31",
        category: "kiosk",
        actor: " Olivia ",
        cursor: "abc123",
      }),
    ).toEqual({
      from: "2026-01-01",
      to: "2026-01-31",
      category: "kiosk",
      actor: "Olivia",
      cursor: "abc123",
    });
  });

  it("swaps from/to when reversed", () => {
    expect(parseAuditFilters({ from: "2026-01-31", to: "2026-01-01" })).toMatchObject({
      from: "2026-01-01",
      to: "2026-01-31",
    });
  });

  it("takes the first value when a param repeats", () => {
    expect(parseAuditFilters({ actor: ["Olivia", "Els"] })).toMatchObject({
      actor: "Olivia",
    });
  });

  it("drops an invalid date rather than failing the whole filter set", () => {
    expect(parseAuditFilters({ from: "not-a-date", actor: "Olivia" })).toEqual({
      from: null,
      to: null,
      category: null,
      actor: "Olivia",
      cursor: null,
    });
  });

  it("drops an unknown category", () => {
    expect(parseAuditFilters({ category: "not_a_category" })).toMatchObject({
      category: null,
    });
  });

  it("drops an empty or over-long actor search", () => {
    expect(parseAuditFilters({ actor: "" })).toMatchObject({ actor: null });
    expect(parseAuditFilters({ actor: "a".repeat(101) })).toMatchObject({
      actor: null,
    });
  });
});
