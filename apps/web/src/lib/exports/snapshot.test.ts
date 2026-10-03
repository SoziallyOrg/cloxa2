import { describe, expect, it } from "vitest";

import type { ClockEvent } from "@cloxa/domain";
import { enabledModules } from "@cloxa/modules";

import { exportContentSchema } from "./content";
import { buildExportContent, type SnapshotInput } from "./snapshot";

const ORG = "10000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-000000000001";
const SITE_A = "20000000-0000-4000-8000-0000000000a1";
const SITE_B = "20000000-0000-4000-8000-0000000000a2";
const ANN = "40000000-0000-4000-8000-000000000001";
const BOB = "40000000-0000-4000-8000-000000000002";

let counter = 0;
function event(
  employeeId: string,
  type: ClockEvent["type"],
  iso: string,
  extra: Partial<ClockEvent> = {},
): ClockEvent {
  counter += 1;
  return {
    id: `ev-${String(counter).padStart(3, "0")}`,
    type,
    occurredAt: Date.parse(iso),
    employeeId,
    siteId: SITE_A,
    source: "app",
    ...extra,
  };
}

function input(overrides: Partial<SnapshotInput>): SnapshotInput {
  return {
    organizationId: ORG,
    createdBy: USER,
    generatedAt: Date.parse("2026-09-10T08:00:00Z"),
    period: { from: "2026-09-01", to: "2026-09-05" },
    siteIds: null,
    siteNames: new Map([
      [SITE_A, "Gent"],
      [SITE_B, "Brugge"],
    ]),
    employees: [
      { id: BOB, code: "B-2", name: "Bob" },
      { id: ANN, code: "A-1", name: "Ann" },
    ],
    events: [],
    planned: [],
    ...overrides,
  };
}

describe("buildExportContent", () => {
  it("puts an overnight shift on the day it started and compares it with the plan", () => {
    const content = buildExportContent(
      input({
        events: [
          event(ANN, "clock_in", "2026-09-01T20:00:00Z"),
          event(ANN, "break_start", "2026-09-01T23:00:00Z"),
          event(ANN, "break_end", "2026-09-01T23:30:00Z"),
          event(ANN, "clock_out", "2026-09-02T04:00:00Z"),
        ],
        planned: [
          {
            employeeId: ANN,
            day: "2026-09-01",
            start: Date.parse("2026-09-01T20:00:00Z"),
            end: Date.parse("2026-09-02T04:00:00Z"),
          },
        ],
      }),
    );

    expect(content.rows).toHaveLength(1);
    const [row] = content.rows;
    expect(row).toMatchObject({
      day: "2026-09-01",
      employee_id: ANN,
      employee_code: "A-1",
      employee_name: "Ann",
      planned_ms: 8 * 3600_000,
      worked_net_ms: 7.5 * 3600_000,
      deviation_ms: -30 * 60_000,
      edited: false,
    });
    expect(row?.shifts).toEqual([
      {
        site_id: SITE_A,
        site_name: "Gent",
        start_utc: "2026-09-01T20:00:00.000Z",
        end_utc: "2026-09-02T04:00:00.000Z",
        start_local: "2026-09-01T22:00:00+02:00",
        end_local: "2026-09-02T06:00:00+02:00",
        break_ms: 30 * 60_000,
        gross_ms: 8 * 3600_000,
        net_ms: 7.5 * 3600_000,
        edited: false,
        open: false,
        overnight: true,
      },
    ]);
    expect(exportContentSchema.parse(content)).toEqual(content);
  });

  it("flags a shift a correction moved an event of", () => {
    const original = event(ANN, "clock_out", "2026-09-03T14:00:00Z");
    const content = buildExportContent(
      input({
        events: [
          event(ANN, "clock_in", "2026-09-03T06:00:00Z"),
          original,
          event(ANN, "clock_out", "2026-09-03T15:00:00Z", {
            source: "correction",
            supersedesEventId: original.id,
          }),
        ],
      }),
    );

    expect(content.rows[0]?.shifts[0]).toMatchObject({
      end_utc: "2026-09-03T15:00:00.000Z",
      gross_ms: 9 * 3600_000,
      edited: true,
    });
    expect(content.rows[0]?.edited).toBe(true);
  });

  it("flags a shift a correction removed a break from", () => {
    const breakStart = event(ANN, "break_start", "2026-09-04T10:00:00Z");
    const breakEnd = event(ANN, "break_end", "2026-09-04T10:30:00Z");
    const content = buildExportContent(
      input({
        events: [
          event(ANN, "clock_in", "2026-09-04T06:00:00Z"),
          breakStart,
          breakEnd,
          event(ANN, "clock_out", "2026-09-04T14:00:00Z"),
          event(ANN, "void", "2026-09-04T10:00:00Z", {
            source: "correction",
            supersedesEventId: breakStart.id,
          }),
          event(ANN, "void", "2026-09-04T10:30:00Z", {
            source: "correction",
            supersedesEventId: breakEnd.id,
          }),
        ],
      }),
    );

    expect(content.rows[0]?.shifts[0]).toMatchObject({ break_ms: 0, edited: true });
  });

  it("keeps only shifts that started in the period at a selected site", () => {
    const content = buildExportContent(
      input({
        siteIds: [SITE_A],
        events: [
          // Started on 31 August (Brussels): belongs to the previous period.
          event(ANN, "clock_in", "2026-08-31T20:00:00Z"),
          event(ANN, "clock_out", "2026-09-01T02:00:00Z"),
          event(BOB, "clock_in", "2026-09-02T06:00:00Z", { siteId: SITE_B }),
          event(BOB, "clock_out", "2026-09-02T14:00:00Z", { siteId: SITE_B }),
          event(BOB, "clock_in", "2026-09-03T06:00:00Z"),
        ],
      }),
    );

    expect(content.site_ids).toEqual([SITE_A]);
    expect(content.rows).toHaveLength(1);
    expect(content.rows[0]).toMatchObject({ employee_id: BOB, day: "2026-09-03" });
    expect(content.rows[0]?.shifts[0]).toMatchObject({
      open: true,
      end_utc: null,
      end_local: null,
    });
  });

  it("adds planned days without a shift and sorts by name, then day", () => {
    const content = buildExportContent(
      input({
        events: [
          event(BOB, "clock_in", "2026-09-01T06:00:00Z"),
          event(BOB, "clock_out", "2026-09-01T10:00:00Z"),
        ],
        planned: [
          {
            employeeId: ANN,
            day: "2026-09-05",
            start: Date.parse("2026-09-05T06:00:00Z"),
            end: Date.parse("2026-09-05T14:00:00Z"),
          },
          {
            employeeId: ANN,
            day: "2026-09-02",
            start: Date.parse("2026-09-02T06:00:00Z"),
            end: Date.parse("2026-09-02T10:00:00Z"),
          },
          {
            employeeId: ANN,
            day: "2026-09-06",
            start: Date.parse("2026-09-06T06:00:00Z"),
            end: Date.parse("2026-09-06T10:00:00Z"),
          },
        ],
      }),
    );

    expect(content.rows.map((row) => [row.employee_name, row.day])).toEqual([
      ["Ann", "2026-09-02"],
      ["Ann", "2026-09-05"],
      ["Bob", "2026-09-01"],
    ]);
    expect(content.rows[1]).toMatchObject({
      shifts: [],
      planned_ms: 8 * 3600_000,
      worked_net_ms: 0,
      deviation_ms: -8 * 3600_000,
    });
  });

  it("measures a fall-back night by real elapsed time", () => {
    const content = buildExportContent(
      input({
        period: { from: "2026-10-25", to: "2026-10-25" },
        events: [
          event(ANN, "clock_in", "2026-10-24T22:30:00Z"),
          event(ANN, "clock_out", "2026-10-25T07:00:00Z"),
        ],
      }),
    );

    expect(content.rows[0]?.shifts[0]).toMatchObject({
      start_local: "2026-10-25T00:30:00+02:00",
      end_local: "2026-10-25T08:00:00+01:00",
      gross_ms: 8.5 * 3600_000,
      overnight: false,
    });
  });

  it("adds module columns per employee-day, only for the modules that apply", () => {
    const content = buildExportContent(
      input({
        period: { from: "2026-09-01", to: "2026-09-01" },
        events: [
          event(ANN, "clock_in", "2026-09-01T06:00:00Z", { workLocation: "home" }),
          event(ANN, "clock_out", "2026-09-01T10:00:00Z"),
          event(BOB, "clock_in", "2026-09-01T07:00:00Z", { workLocation: "site" }),
          event(BOB, "clock_out", "2026-09-01T11:00:00Z"),
        ],
        modules: {
          enabled: enabledModules([
            { module: "telework", enabled: true, config: {} },
            { module: "student", enabled: true, config: {} },
            { module: "interim", enabled: true, config: {} },
          ]),
          statutes: new Map([
            [ANN, "student"],
            [BOB, "interim"],
          ]),
          data: new Map([[BOB, new Map([["interim", { agency_name: "Uitzend NV" }]])]]),
          yearEvents: new Map([
            [
              ANN,
              [
                event(ANN, "clock_in", "2026-02-02T08:00:00Z"),
                event(ANN, "clock_out", "2026-02-02T10:00:00Z"),
                event(ANN, "clock_in", "2026-09-01T06:00:00Z"),
                event(ANN, "clock_out", "2026-09-01T10:00:00Z"),
              ],
            ],
          ]),
          interimAgency: null,
        },
      }),
    );

    expect(content.modules).toEqual(["interim", "student", "telework"]);
    expect(content).not.toHaveProperty("interim_agency");
    const [ann, bob] = content.rows;
    expect(ann?.modules).toEqual({
      student: { quarter: "2026-Q3", year_to_date_net_ms: 6 * 3600_000 },
      telework: { home_shifts: 1, site_shifts: 0 },
    });
    expect(bob?.modules).toEqual({
      interim: { agency_name: "Uitzend NV", agency_reference: null },
      telework: { home_shifts: 0, site_shifts: 1 },
    });
    expect(exportContentSchema.safeParse(content).success).toBe(true);
  });

  it("names the agency of an agency export, and has no modules without any on", () => {
    const agency = buildExportContent(
      input({
        modules: {
          enabled: enabledModules([{ module: "interim", enabled: true, config: {} }]),
          statutes: new Map(),
          data: new Map(),
          yearEvents: new Map(),
          interimAgency: "Uitzend NV",
        },
      }),
    );
    expect(agency.interim_agency).toBe("Uitzend NV");
    expect(agency.modules).toEqual(["interim"]);

    const plain = buildExportContent(input({ modules: null }));
    expect(plain).not.toHaveProperty("modules");
  });

  it("accepts the additive optional module keys in v1, and nothing else new", () => {
    const base = buildExportContent(input({}));
    const withModules = {
      ...base,
      modules: ["interim"],
      interim_agency: "Uitzend NV",
      rows: [
        {
          day: "2026-09-01",
          employee_id: ANN,
          employee_code: null,
          employee_name: "Ann",
          shifts: [],
          planned_ms: 0,
          worked_net_ms: 0,
          deviation_ms: 0,
          edited: false,
          modules: { interim: { agency_name: "Uitzend NV", agency_reference: null } },
        },
      ],
    };
    expect(exportContentSchema.safeParse(withModules).success).toBe(true);
    expect(exportContentSchema.safeParse({ ...withModules, other: 1 }).success).toBe(
      false,
    );
    expect(
      exportContentSchema.safeParse({ ...withModules, interim_agency: "Uitzend\nNV" })
        .success,
    ).toBe(false);
    expect(
      exportContentSchema.safeParse({ ...withModules, modules: ["ciao"] }).success,
    ).toBe(false);
  });

  it("writes the header the database checks", () => {
    const content = buildExportContent(input({ siteIds: null }));
    expect(content).toEqual({
      format_version: "cloxa.export.v1",
      organization_id: ORG,
      created_by: USER,
      generated_at: "2026-09-10T08:00:00.000Z",
      period: { from: "2026-09-01", to: "2026-09-05", timezone: "Europe/Brussels" },
      site_ids: null,
      rows: [],
    });
  });
});
