import { describe, expect, it, vi } from "vitest";

import type { CloxaClient } from "@cloxa/db";

vi.mock("server-only", () => ({}));

const { loadSnapshotInput } = await import("./load");

const ORG = "10000000-0000-4000-8000-000000000001";
const SITE = "20000000-0000-4000-8000-0000000000a1";
const ANN = "40000000-0000-4000-8000-000000000001";
const BOB = "40000000-0000-4000-8000-000000000002";
const CAS = "40000000-0000-4000-8000-000000000003";

type Row = Record<string, unknown>;

/**
 * Just enough of the Supabase query builder for the loader: `eq`, `in` and
 * `not(..., "is", null)` filter the table's rows; ordering and paging are
 * ignored (every table here fits one page).
 */
function fakeClient(tables: Record<string, Row[]>): CloxaClient {
  function query(rows: Row[]) {
    let current = rows;
    const builder = {
      select: () => builder,
      order: () => builder,
      range: () => builder,
      gte: () => builder,
      lt: () => builder,
      eq(column: string, value: unknown) {
        current = current.filter((row) => row[column] === value);
        return builder;
      },
      in(column: string, values: readonly unknown[]) {
        current = current.filter((row) => values.includes(row[column]));
        return builder;
      },
      not(column: string) {
        current = current.filter((row) => row[column] !== null);
        return builder;
      },
      then(resolve: (result: { data: Row[]; error: null }) => unknown) {
        return Promise.resolve({ data: current, error: null }).then(resolve);
      },
    };
    return builder;
  }
  return {
    from: (table: string) => query(tables[table] ?? []),
    rpc: () => Promise.resolve({ data: [], error: null }),
  } as unknown as CloxaClient;
}

const employee = (id: string, name: string, statute: string) => ({
  id,
  organization_id: ORG,
  display_name: name,
  employee_code: null,
  statute,
});
const assignment = (id: string) => ({
  organization_id: ORG,
  site_id: SITE,
  employee_id: id,
});
const agency = (id: string, name: string) => ({
  organization_id: ORG,
  employee_id: id,
  module: "interim",
  data: { agency_name: name },
});

describe("loadSnapshotInput", () => {
  it("keeps only interim workers of the chosen agency in an agency export", async () => {
    const client = fakeClient({
      sites: [{ id: SITE, name: "Gent", organization_id: ORG }],
      site_assignments: [assignment(ANN), assignment(BOB), assignment(CAS)],
      employees: [
        employee(ANN, "Ann", "interim"),
        employee(BOB, "Bob", "interim"),
        // Same agency, but not an interim worker (data from before the rule).
        employee(CAS, "Cas", "bediende"),
      ],
      org_modules: [
        { organization_id: ORG, module: "interim", enabled: true, config: {} },
      ],
      employee_module_data: [
        agency(ANN, "Uitzend A"),
        agency(BOB, "Uitzend B"),
        agency(CAS, "Uitzend A"),
      ],
    });

    const input = await loadSnapshotInput(client, {
      organizationId: ORG,
      createdBy: "00000000-0000-4000-8000-000000000001",
      generatedAt: Date.parse("2026-10-01T08:00:00Z"),
      period: { from: "2026-09-01", to: "2026-09-30" },
      siteIds: null,
      withModules: true,
      interimAgency: "Uitzend A",
    });

    expect(input.employees.map((person) => person.id)).toEqual([ANN]);
    expect(input.modules?.interimAgency).toBe("Uitzend A");
    expect(input.modules?.enabled.map(({ module }) => module.id)).toEqual(["interim"]);
  });

  it("leaves modules out entirely when none is asked for", async () => {
    const client = fakeClient({
      sites: [{ id: SITE, name: "Gent", organization_id: ORG }],
      site_assignments: [assignment(ANN)],
      employees: [employee(ANN, "Ann", "interim")],
      org_modules: [
        { organization_id: ORG, module: "interim", enabled: true, config: {} },
      ],
    });
    const input = await loadSnapshotInput(client, {
      organizationId: ORG,
      createdBy: "00000000-0000-4000-8000-000000000001",
      generatedAt: 0,
      period: { from: "2026-09-01", to: "2026-09-30" },
      siteIds: null,
    });
    expect(input.modules).toBeNull();
    expect(input.employees).toHaveLength(1);
  });
});
