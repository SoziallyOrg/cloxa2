import { describe, expect, it } from "vitest";

import type { ExportContent, ExportShift } from "./content";
import {
  hoursOf,
  minutesOf,
  neutralizeSpreadsheetCell,
  serializeExportCsv,
} from "./csv";

const SITE = "20000000-0000-4000-8000-0000000000a1";
const EMPLOYEE = "40000000-0000-4000-8000-000000000001";

function shift(overrides: Partial<ExportShift> = {}): ExportShift {
  return {
    site_id: SITE,
    site_name: "Gent",
    start_utc: "2026-09-01T06:00:00.000Z",
    end_utc: "2026-09-01T14:30:00.000Z",
    start_local: "2026-09-01T08:00:00+02:00",
    end_local: "2026-09-01T16:30:00+02:00",
    break_ms: 30 * 60_000,
    gross_ms: 8.5 * 3600_000,
    net_ms: 8 * 3600_000,
    edited: false,
    open: false,
    overnight: false,
    ...overrides,
  };
}

function content(rows: ExportContent["rows"]): ExportContent {
  return {
    format_version: "cloxa.export.v1",
    organization_id: "10000000-0000-4000-8000-000000000001",
    created_by: "00000000-0000-4000-8000-000000000001",
    generated_at: "2026-10-01T08:00:00.000Z",
    period: { from: "2026-09-01", to: "2026-10-31", timezone: "Europe/Brussels" },
    site_ids: null,
    rows,
  };
}

const ROW = {
  day: "2026-09-01",
  employee_id: EMPLOYEE,
  employee_code: "A-1",
  employee_name: "Ann Peeters",
  planned_ms: 7.75 * 3600_000,
  worked_net_ms: 8 * 3600_000,
  deviation_ms: 15 * 60_000,
  edited: false,
};

function lines(csv: string): string[] {
  return csv.slice(1).split("\r\n");
}

describe("serializeExportCsv", () => {
  it("adds columns only for the modules the export lists", () => {
    const csv = serializeExportCsv({
      ...content([
        {
          ...ROW,
          shifts: [shift(), shift({ start_utc: "2026-09-01T15:00:00.000Z" })],
          modules: {
            interim: { agency_name: "=Uitzend NV", agency_reference: null },
            overuren: { above_planned_ms: 15 * 60_000 },
          },
        },
      ]),
      modules: ["interim", "overuren"],
    });
    const [header, first, second] = lines(csv);
    expect(
      header?.endsWith(
        ";Nog bezig;Uitzendkantoor;Referentie uitzendkantoor;Overuren: boven de planning (uur, indicatief)",
      ),
    ).toBe(true);
    // Text repeats on every line (formula-guarded); a duration is a day total.
    expect(first?.endsWith(";nee;'=Uitzend NV;;0,25")).toBe(true);
    expect(second?.endsWith(";nee;'=Uitzend NV;;")).toBe(true);
  });

  it("has no module columns when the export lists none", () => {
    const csv = serializeExportCsv(content([{ ...ROW, shifts: [shift()] }]));
    expect(lines(csv)[0]?.endsWith(";Aangepast;Nog bezig")).toBe(true);
  });

  it("starts with a UTF-8 BOM and uses ; with CRLF line ends", () => {
    const csv = serializeExportCsv(content([{ ...ROW, shifts: [shift()] }]));
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(lines(csv)[0]).toBe(
      "Datum;Personeelsnummer;Naam;Locatie;Start (Brussel);Einde (Brussel);Start (UTC);Einde (UTC);" +
        "Pauze (min);Bruto (min);Netto (min);Netto (uur);Gepland dag (min);Gepland dag (uur);" +
        "Verschil dag, indicatief (min);Verschil dag, indicatief (uur);Aangepast;Nog bezig",
    );
  });

  it("writes minutes and decimal-comma hours", () => {
    const csv = serializeExportCsv(content([{ ...ROW, shifts: [shift()] }]));
    expect(lines(csv)[1]).toBe(
      "2026-09-01;A-1;Ann Peeters;Gent;2026-09-01 08:00;2026-09-01 16:30;" +
        "2026-09-01T06:00:00.000Z;2026-09-01T14:30:00.000Z;30;510;480;8,00;465;7,75;15;0,25;nee;nee",
    );
  });

  it("puts day totals on the first line of a day only", () => {
    const csv = serializeExportCsv(
      content([
        {
          ...ROW,
          deviation_ms: -45 * 60_000,
          shifts: [
            shift({ net_ms: 4 * 3600_000 }),
            shift({ net_ms: 3 * 3600_000, edited: true }),
          ],
        },
      ]),
    );
    const [, first, second] = lines(csv);
    expect(first?.split(";").slice(12, 16)).toEqual(["465", "7,75", "-45", "-0,75"]);
    expect(second?.split(";").slice(10, 18)).toEqual([
      "180",
      "3,00",
      "",
      "",
      "",
      "",
      "ja",
      "nee",
    ]);
  });

  it("writes a planned day without a shift as one line with empty shift columns", () => {
    const csv = serializeExportCsv(
      content([
        {
          ...ROW,
          employee_code: null,
          shifts: [],
          worked_net_ms: 0,
          deviation_ms: -ROW.planned_ms,
        },
      ]),
    );
    expect(lines(csv)[1]).toBe(
      "2026-09-01;;Ann Peeters;;;;;;;;;;465;7,75;-465;-7,75;nee;",
    );
  });

  it("neutralizes formulas in names, codes and sites, and quotes separators", () => {
    const csv = serializeExportCsv(
      content([
        {
          ...ROW,
          employee_code: "=HYPERLINK(1)",
          employee_name: '+Jan; "de" Smet',
          shifts: [shift({ site_name: "@Gent" })],
        },
      ]),
    );
    const line = lines(csv)[1] ?? "";
    expect(
      line.startsWith(`2026-09-01;'=HYPERLINK(1);"'+Jan; ""de"" Smet";'@Gent;`),
    ).toBe(true);
  });

  it("writes a DST fall-back shift with both offsets' wall times and real minutes", () => {
    const csv = serializeExportCsv(
      content([
        {
          ...ROW,
          day: "2026-10-25",
          planned_ms: 0,
          worked_net_ms: 8.5 * 3600_000,
          deviation_ms: 8.5 * 3600_000,
          shifts: [
            shift({
              start_utc: "2026-10-24T22:30:00.000Z",
              end_utc: "2026-10-25T07:00:00.000Z",
              start_local: "2026-10-25T00:30:00+02:00",
              end_local: "2026-10-25T08:00:00+01:00",
              break_ms: 0,
              gross_ms: 8.5 * 3600_000,
              net_ms: 8.5 * 3600_000,
            }),
          ],
        },
      ]),
    );
    expect(lines(csv)[1]?.split(";").slice(4, 12)).toEqual([
      "2026-10-25 00:30",
      "2026-10-25 08:00",
      "2026-10-24T22:30:00.000Z",
      "2026-10-25T07:00:00.000Z",
      "0",
      "510",
      "510",
      "8,50",
    ]);
  });

  it("gives the same bytes for the same JSON", () => {
    const source = content([{ ...ROW, shifts: [shift(), shift({ open: true })] }]);
    const again = JSON.parse(JSON.stringify(source)) as ExportContent;
    expect(serializeExportCsv(again)).toBe(serializeExportCsv(source));
  });
});

describe("cell helpers", () => {
  it("rounds minutes half away from zero", () => {
    expect(minutesOf(90.5 * 60_000)).toBe(91);
    expect(minutesOf(-90.5 * 60_000)).toBe(-91);
    expect(minutesOf(-20_000)).toBe(0);
    expect(Object.is(minutesOf(-20_000), -0)).toBe(false);
  });

  it("formats hours with a decimal comma", () => {
    expect(hoursOf(90)).toBe("1,50");
    expect(hoursOf(-20)).toBe("-0,33");
    expect(hoursOf(0)).toBe("0,00");
  });

  it("leaves ordinary text alone", () => {
    expect(neutralizeSpreadsheetCell("Ann")).toBe("Ann");
    expect(neutralizeSpreadsheetCell("-5")).toBe("'-5");
    expect(neutralizeSpreadsheetCell("\tx")).toBe("'\tx");
  });
});
