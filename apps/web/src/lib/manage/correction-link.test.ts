import { describe, expect, it } from "vitest";

import {
  correctedEmployeeId,
  correctionDoneHref,
  correctionHref,
  correctionReturn,
  defaultSiteId,
  parseCorrectionPrefill,
} from "./correction-link";

const ID = "11111111-1111-4111-8111-111111111111";

describe("parseCorrectionPrefill", () => {
  it("reads a forgotten clock-out with its day and return", () => {
    expect(
      parseCorrectionPrefill({ soort: "einde", datum: "2026-10-01", terug: "vandaag" }),
    ).toEqual({ date: "2026-10-01", forgotClockOut: true, returnTo: "vandaag" });
  });

  it("reads a plain day (per-shift Aanpassen)", () => {
    expect(parseCorrectionPrefill({ datum: "2026-10-01" })).toEqual({
      date: "2026-10-01",
      forgotClockOut: false,
      returnTo: "medewerker",
    });
  });

  it("ignores unknown and invalid values", () => {
    expect(
      parseCorrectionPrefill({
        soort: "begin",
        datum: "2026-13-45",
        terug: "https://evil.test",
      }),
    ).toEqual({ date: null, forgotClockOut: false, returnTo: "medewerker" });
    expect(parseCorrectionPrefill({ datum: "gisteren" }).date).toBeNull();
    expect(parseCorrectionPrefill({ datum: "2026-02-30" }).date).toBeNull();
  });

  it("needs a valid day for a forgotten clock-out", () => {
    expect(parseCorrectionPrefill({ soort: "einde" }).forgotClockOut).toBe(false);
    expect(parseCorrectionPrefill({ soort: "einde", datum: "x" }).forgotClockOut).toBe(
      false,
    );
  });

  it("takes the first of repeated values", () => {
    expect(parseCorrectionPrefill({ datum: ["2026-10-01", "2026-10-02"] }).date).toBe(
      "2026-10-01",
    );
  });

  it("ignores days outside the bounds", () => {
    const bounds = { earliest: "2026-08-01", latest: "2026-10-03" };
    expect(parseCorrectionPrefill({ datum: "2026-10-03" }, bounds).date).toBe(
      "2026-10-03",
    );
    expect(parseCorrectionPrefill({ datum: "2026-10-04" }, bounds).date).toBeNull();
    expect(
      parseCorrectionPrefill({ datum: "2020-01-01", soort: "einde" }, bounds),
    ).toMatchObject({ date: null, forgotClockOut: false });
  });
});

describe("correctionReturn", () => {
  it("is one of two fixed places", () => {
    expect(correctionReturn("vandaag")).toBe("vandaag");
    expect(correctionReturn("medewerker")).toBe("medewerker");
    expect(correctionReturn("/manage/team")).toBe("medewerker");
    expect(correctionReturn(undefined)).toBe("medewerker");
  });
});

describe("correctionHref / correctionDoneHref", () => {
  it("builds the link for a forgotten clock-out", () => {
    expect(
      correctionHref(ID, {
        date: "2026-10-01",
        forgotClockOut: true,
        returnTo: "vandaag",
      }),
    ).toBe(
      `/manage/medewerker/${ID}/correctie?soort=einde&datum=2026-10-01&terug=vandaag`,
    );
  });

  it("is plain without options, and round-trips through the parser", () => {
    expect(correctionHref(ID)).toBe(`/manage/medewerker/${ID}/correctie`);
    const href = correctionHref(ID, { date: "2026-10-01", returnTo: "medewerker" });
    const query = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(parseCorrectionPrefill(query)).toEqual({
      date: "2026-10-01",
      forgotClockOut: false,
      returnTo: "medewerker",
    });
  });

  it("returns to a fixed place with the corrected employee", () => {
    expect(correctionDoneHref("vandaag", ID)).toBe(`/manage?gecorrigeerd=${ID}`);
    expect(correctionDoneHref("medewerker", ID)).toBe(
      `/manage/medewerker/${ID}?gecorrigeerd=${ID}`,
    );
    expect(correctedEmployeeId(ID)).toBe(ID);
    expect(correctedEmployeeId("nope")).toBeNull();
    expect(correctedEmployeeId(undefined)).toBeNull();
  });
});

describe("defaultSiteId", () => {
  const sites = [{ id: "a" }, { id: "b" }];
  const day = (at: number) => (at < 100 ? "d1" : "d2");

  it("takes the site of the day's last registration", () => {
    const events = [
      { siteId: "a", occurredAt: 10 },
      { siteId: "b", occurredAt: 20 },
      { siteId: "a", occurredAt: 150 },
    ];
    expect(defaultSiteId(events, sites, day, "d1")).toBe("b");
    expect(defaultSiteId(events, sites, day, null)).toBe("a");
  });

  it("falls back to the first assigned site", () => {
    expect(defaultSiteId([], sites, day, "d1")).toBe("a");
    expect(defaultSiteId([{ siteId: "gone", occurredAt: 1 }], sites, day, null)).toBe(
      "a",
    );
    expect(defaultSiteId([], [], day, null)).toBeNull();
  });
});
