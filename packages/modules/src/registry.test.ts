import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { catalog } from "@cloxa/i18n";

import { exportModules, yearToDateNetMs } from "./exports";
import { hasControlCharacter, interimAgency } from "./interim";
import {
  appliesTo,
  configFromChoices,
  currentChoices,
  enabledModules,
  fieldsFromForm,
  fieldsToForm,
  fieldValue,
  isModuleId,
  moduleById,
  MODULES,
  modulesFor,
} from "./registry";
import { at, HOUR, shift } from "./test-support";
import { MODULE_IDS, STATUTES } from "./types";

// packages/modules/src -> repo root.
const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "supabase", "migrations");

/**
 * The statute map of the newest `private.module_statutes` in the migrations:
 * `when '<module>' then array['a', 'b']` per module.
 */
function sqlModuleStatutes(): Map<string, string[]> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  let body: string | null = null;
  for (const name of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
    const match =
      /function private\.module_statutes\(p_module text\)[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(
        sql,
      );
    if (match) body = match[1]!;
  }
  if (body === null) throw new Error("no private.module_statutes in the migrations");
  const map = new Map<string, string[]>();
  for (const [, module, list] of body.matchAll(
    /when '(\w+)' then array\[([^\]]*)\]/g,
  )) {
    map.set(
      module!,
      [...list!.matchAll(/'(\w+)'/g)].map(([, statute]) => statute!).sort(),
    );
  }
  return map;
}

describe("registry", () => {
  it("knows exactly the five modules of ADR 008, in a fixed order", () => {
    expect(MODULES.map((module) => module.id)).toEqual([...MODULE_IDS]);
    expect(isModuleId("telework")).toBe(true);
    expect(isModuleId("ciao")).toBe(false);
    expect(isModuleId(null)).toBe(false);
  });

  it("gives every module its own copy keys", () => {
    for (const definition of MODULES) {
      expect(definition.label.startsWith(`modules.${definition.id}.`)).toBe(true);
      expect(definition.description.startsWith(`modules.${definition.id}.`)).toBe(true);
    }
  });

  it("keeps enabled modules in registry order and drops unknown or disabled rows", () => {
    const enabled = enabledModules([
      { module: "telework", enabled: true, config: {} },
      { module: "ciao", enabled: true, config: {} },
      { module: "student", enabled: true, config: {} },
      { module: "flexi", enabled: false, config: {} },
    ]);
    expect(enabled.map(({ module }) => module.id)).toEqual(["student", "telework"]);
    expect(modulesFor(enabled, "student").map(({ module }) => module.id)).toEqual([
      "student",
      "telework",
    ]);
    expect(modulesFor(enabled, "bediende").map(({ module }) => module.id)).toEqual([
      "telework",
    ]);
  });

  it("uses the same statutes as private.module_statutes in SQL", () => {
    const sql = sqlModuleStatutes();
    expect([...sql.keys()].sort()).toEqual([...MODULE_IDS].sort());
    for (const definition of MODULES) {
      const statutes =
        definition.statutes === "all" ? [...STATUTES] : [...definition.statutes];
      expect(sql.get(definition.id), definition.id).toEqual(statutes.sort());
    }
  });

  it("applies modules by statute", () => {
    expect(appliesTo(moduleById("interim"), "interim")).toBe(true);
    expect(appliesTo(moduleById("interim"), "bediende")).toBe(false);
    expect(appliesTo(moduleById("overuren"), "student")).toBe(false);
    expect(appliesTo(moduleById("telework"), "flexi")).toBe(true);
  });
});

describe("copy", () => {
  function strings(value: unknown): string[] {
    if (typeof value === "string") return [value];
    if (value !== null && typeof value === "object") {
      return Object.values(value).flatMap(strings);
    }
    return [];
  }

  it("never claims a legal outcome (CLAUDE.md), and figures say indicatief", () => {
    const copy = strings(catalog.modules);
    const forbidden =
      /\b(mag|mogen|moet|moeten|verplicht|wettelijk|in orde|compliant|inspectieproof|boete|premie|recht op)\b/i;
    expect(copy.filter((text) => forbidden.test(text))).toEqual([]);
    expect(catalog.modules.student.remaining).toContain("(indicatief)");
    expect(catalog.modules.student.over).toContain("(indicatief)");
    expect(catalog.modules.overuren.thresholds).toContain("(indicatief)");
  });
});

describe("fields", () => {
  const interim = moduleById("interim");
  const student = moduleById("student");

  it("turns form strings into validated data, leaving empty optional fields out", () => {
    expect(
      fieldsFromForm(interim, { agency_name: "  Uitzend NV ", agency_reference: "" }),
    ).toEqual({ ok: true, data: { agency_name: "Uitzend NV" } });
    expect(
      fieldsFromForm(student, { hours_elsewhere: "37,5", checked_on: "2026-09-01" }),
    ).toEqual({ ok: true, data: { hours_elsewhere: 37.5, checked_on: "2026-09-01" } });
  });

  it("names the fields that need another look", () => {
    expect(fieldsFromForm(interim, { agency_name: "" })).toEqual({
      ok: false,
      invalid: ["agency_name"],
    });
    expect(fieldsFromForm(interim, { agency_name: "x".repeat(121) })).toEqual({
      ok: false,
      invalid: ["agency_name"],
    });
    expect(
      fieldsFromForm(student, { hours_elsewhere: "12 uur", checked_on: "" }),
    ).toEqual({
      ok: false,
      invalid: ["hours_elsewhere"],
    });
    expect(fieldsFromForm(student, { hours_elsewhere: "12", checked_on: "" })).toEqual({
      ok: false,
      invalid: ["checked_on"],
    });
    expect(fieldsFromForm(moduleById("telework"), {})).toEqual({
      ok: false,
      invalid: [],
    });
  });

  it("round-trips saved data into the form and into display values", () => {
    const data = { hours_elsewhere: 37.5, checked_on: "2026-09-01" };
    expect(fieldsToForm(student, data)).toEqual({
      hours_elsewhere: "37,5",
      checked_on: "2026-09-01",
    });
    expect(fieldsToForm(student, null)).toEqual({
      hours_elsewhere: "",
      checked_on: "",
    });
    const [hours, date] = student.fields;
    expect(fieldValue(hours!, data)).toEqual({ durationMs: 37.5 * HOUR });
    expect(fieldValue(date!, data)).toEqual({ day: "2026-09-01" });
    expect(fieldValue(interim.fields[1]!, { agency_name: "X" })).toBeNull();
  });

  it("refuses control characters in agency fields", () => {
    expect(hasControlCharacter("Uitzend NV")).toBe(false);
    expect(hasControlCharacter("Uitzend\nNV")).toBe(true);
    expect(hasControlCharacter("Uitzend\u007fNV")).toBe(true);
    expect(fieldsFromForm(interim, { agency_name: "Uitzend\tNV" })).toEqual({
      ok: false,
      invalid: ["agency_name"],
    });
    expect(
      fieldsFromForm(interim, {
        agency_name: "Uitzend NV",
        agency_reference: "R\u0001",
      }),
    ).toEqual({ ok: false, invalid: ["agency_reference"] });
  });

  it("reads the agency of an interim worker", () => {
    expect(interimAgency({ agency_name: "Uitzend NV" })).toBe("Uitzend NV");
    expect(interimAgency({})).toBeNull();
    expect(interimAgency(null)).toBeNull();
  });
});

describe("config", () => {
  const overuren = moduleById("overuren");

  it("accepts only the offered choices", () => {
    expect(configFromChoices(overuren, { sector: "horeca" })).toEqual({
      ok: true,
      config: { sector: "horeca" },
    });
    expect(configFromChoices(overuren, { sector: "bouw" })).toEqual({ ok: false });
    expect(configFromChoices(moduleById("telework"), {})).toEqual({
      ok: true,
      config: {},
    });
  });

  it("shows the first option when nothing was chosen yet", () => {
    expect(currentChoices(overuren, {})).toEqual({ sector: "general" });
    expect(currentChoices(overuren, { sector: "horeca" })).toEqual({
      sector: "horeca",
    });
  });
});

describe("exports", () => {
  it("adds year-to-date time from 1 January up to the day", () => {
    const shifts = [
      shift("2025-12-31", "09:00", "17:00"),
      shift("2026-01-02", "09:00", "13:00"),
      shift("2026-02-02", "09:00", "11:00"),
      shift("2026-02-03", "09:00", "11:00"),
    ];
    expect(yearToDateNetMs(shifts, "2026-02-02")).toBe(6 * HOUR);
  });

  it("fills a row's modules only for enabled modules that apply", () => {
    const enabled = enabledModules([
      { module: "student", enabled: true, config: {} },
      { module: "interim", enabled: true, config: {} },
      { module: "telework", enabled: true, config: {} },
    ]);
    const day = shift("2026-02-02", "09:00", "11:00", { workLocation: "home" });
    const row = exportModules(
      enabled,
      "student",
      { day: "2026-02-02", shifts: [day], planned: [] },
      () => null,
      [shift("2026-01-05", "09:00", "10:00"), day],
    );
    expect(row).toEqual({
      student: { quarter: "2026-Q1", year_to_date_net_ms: 3 * HOUR },
      telework: { home_shifts: 1, site_shifts: 0 },
    });
    expect(at("2026-02-02", "09:00")).toBe(day.start);
  });
});
