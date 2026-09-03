import { describe, expect, it } from "vitest";
import {
  formatExactDuration,
  isValidExportPeriod,
  parseTimeExportHistory,
  parseTimeExportPreview,
  parseTimeExportSnapshot,
} from "@/lib/time-exports/model";
import {
  manifestWire,
  recordWire,
  snapshotWire,
} from "@/lib/time-exports/fixtures.test-data";

describe("time export provider boundaries", () => {
  it("parses exact manifest and autumn-offset records without float conversion", () => {
    expect(parseTimeExportSnapshot(snapshotWire)).toMatchObject({
      manifest: { totalDurationMicroseconds: "7200000001" },
      records: [
        {
          startedAtBrussels: "2010-10-31T02:30:00.123456+02:00",
          endedAtBrussels: "2010-10-31T03:30:00.123457+01:00",
        },
      ],
    });
    expect(formatExactDuration("7200000001")).toBe("2:00:00.000001");
  });

  it("parses exact preview and bounded history", () => {
    const preview = {
      timezone: "Europe/Brussels",
      period_start_local: "2010-03-28",
      period_end_local: "2010-03-28",
      utc_start_inclusive: "2010-03-27T23:00:00.000000Z",
      utc_end_exclusive: "2010-03-28T22:00:00.000000Z",
      record_count: 0,
      employee_count: 0,
      total_duration_microseconds: "0",
      blockers: ["no_records"],
      warnings: ["missing_employee_code"],
      records: [],
    };
    expect(parseTimeExportPreview(preview)?.utcEndExclusive).toBe(
      "2010-03-28T22:00:00.000000Z",
    );
    expect(parseTimeExportHistory({ exports: [manifestWire] })).toHaveLength(1);
  });

  it.each([
    null,
    {},
    { ...snapshotWire, extra: true },
    { ...snapshotWire, records: [] },
    { ...snapshotWire, records: [{ ...recordWire, row_ordinal: 2 }] },
    {
      ...snapshotWire,
      records: [{ ...recordWire, duration_microseconds: "7200000000" }],
    },
    {
      ...snapshotWire,
      records: [{ ...recordWire, started_at_utc: "2010-10-31T00:30:00Z" }],
    },
    { ...snapshotWire, records: [{ ...recordWire, employee_code: 42 }] },
    {
      ...snapshotWire,
      records: [
        { ...recordWire, started_at_brussels: "2010-10-31T02:30:00.123456+01:00" },
      ],
    },
    {
      ...snapshotWire,
      records: [{ ...recordWire, ended_at_utc: "2010-10-31T02:30:00.123458Z" }],
    },
    {
      ...snapshotWire,
      records: [{ ...recordWire, ended_at_utc: "2010-10-31T25:30:00.123457Z" }],
    },
    {
      ...snapshotWire,
      manifest: { ...manifestWire, period_start_local: "2010-09-01" },
    },
    {
      ...snapshotWire,
      manifest: {
        ...manifestWire,
        period_start_local: "2010-10-30",
        period_end_local: "2010-10-30",
      },
    },
    { ...snapshotWire, records: [{ ...recordWire, internal_membership_id: "secret" }] },
    { ...snapshotWire, manifest: { ...manifestWire, dataset_sha256: "bad" } },
    {
      ...snapshotWire,
      manifest: { ...manifestWire, total_duration_microseconds: 7200000001 },
    },
  ])("rejects malformed snapshot %#", (value) => {
    expect(parseTimeExportSnapshot(value)).toBeNull();
  });

  it.each([
    ["2010-01-01", "2010-01-31", "2010-02-01", true],
    ["2010-01-01", "2010-02-01", "2010-02-01", false],
    ["2010-01-02", "2010-01-01", "2010-02-01", false],
    ["2010-01-01", "2010-02-02", "2010-02-01", false],
    ["2010-02-30", "2010-02-30", "2010-03-01", false],
    ["0099-01-01", "0099-01-01", "2010-03-01", true],
  ])("validates inclusive 31-day periods %s..%s", (start, end, today, expected) => {
    expect(isValidExportPeriod(start, end, today)).toBe(expected);
  });
});
