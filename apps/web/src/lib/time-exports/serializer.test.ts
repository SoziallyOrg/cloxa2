import { describe, expect, it } from "vitest";
import { snapshot } from "@/lib/time-exports/fixtures.test-data";
import {
  createTimeExportArtifact,
  neutralizeSpreadsheetCell,
  safeExportFilename,
  serializeTimeExportCsv,
  serializeTimeExportJson,
} from "@/lib/time-exports/serializer";

describe("deterministic time export serializers", () => {
  it("returns byte-identical ordered JSON with explicit nulls and exact strings", () => {
    const first = serializeTimeExportJson(snapshot);
    const second = serializeTimeExportJson({
      ...snapshot,
      records: [...snapshot.records],
    });
    expect(first).toBe(second);
    const parsed = JSON.parse(first);
    expect(Object.keys(parsed)).toEqual(["manifest", "records"]);
    expect(parsed.records[0].employee_code).toBe("SYN-1");
    expect(parsed.records[0].last_correction_request_id).toBeNull();
    expect(parsed.records[0].duration_microseconds).toBe("7200000001");
  });

  it("orders records by stored ordinal independent of input order", () => {
    const second = {
      ...snapshot.records[0]!,
      rowOrdinal: 2,
      sourceTimeEntryId: "40000000-0000-4000-8000-000000000002",
    };
    const first = snapshot.records[0]!;
    const orderedSnapshot = {
      ...snapshot,
      manifest: {
        ...snapshot.manifest,
        recordCount: 2,
        totalDurationMicroseconds: "14400000002",
      },
      records: [second, first],
    };
    expect(
      JSON.parse(serializeTimeExportJson(orderedSnapshot)).records[0].row_ordinal,
    ).toBe(1);
    expect(parseCsvOrdinals(serializeTimeExportCsv(orderedSnapshot))).toEqual([
      "1",
      "2",
    ]);
  });

  it.each([
    ["=1+1", "'=1+1"],
    ["+SUM(A1)", "'+SUM(A1)"],
    ["-2+3", "'-2+3"],
    ["@cmd", "'@cmd"],
    [" =1+1", "' =1+1"],
    ["\t=1+1", "'\t=1+1"],
    ["\u0001safe", "'\u0001safe"],
    ["\u00a0=1", "'\u00a0=1"],
    ["\u200b=1", "'\u200b=1"],
    ["\ufeff@cmd", "'\ufeff@cmd"],
    ["\u0085+1", "'\u0085+1"],
    ["veilig", "veilig"],
    ["Élodie", "Élodie"],
  ])("neutralizes spreadsheet cell %j", (value, expected) => {
    expect(neutralizeSpreadsheetCell(value)).toBe(expected);
  });

  it("quotes commas, semicolons, quotes, CR/LF, accents, controls and long text", () => {
    const malicious = {
      ...snapshot,
      records: [
        {
          ...snapshot.records[0]!,
          employeeCode: '=SYN,"é";\r\nnext',
          employeeDisplayName: " leading\tnaam",
          worksiteName: `Werkplek; "Noord" ${"lang".repeat(1000)}`,
        },
      ],
    };
    const csv = serializeTimeExportCsv(malicious);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv).toContain('"\'=SYN,""é"";\r\nnext"');
    expect(csv).toContain('"\' leading\tnaam"');
    expect(csv).toContain('"Werkplek; ""Noord""');
    expect(serializeTimeExportCsv(malicious)).toBe(csv);
  });

  it("uses ASCII-controlled filenames and stable artifact hashes", () => {
    expect(safeExportFilename(snapshot, "csv")).toBe(
      "cloxa-time-export_2010-10-31_2010-10-31_10000000.csv",
    );
    const one = createTimeExportArtifact(snapshot, "json")!;
    const two = createTimeExportArtifact(snapshot, "json")!;
    expect(one.bytes).toEqual(two.bytes);
    expect(one.sha256).toBe(two.sha256);
    expect(one.sha256).toMatch(/^[0-9a-f]{64}$/u);
  });
});

function parseCsvOrdinals(value: string) {
  return value
    .split("\r\n")
    .slice(1, -1)
    .map((line) => line.split(",")[13]?.replaceAll('"', ""));
}
