/**
 * The registry: the only place the rest of Cloxa learns which modules exist.
 * Order here is the order everywhere (the Modules list, sections, exports).
 */
import { HOUR_MS } from "./calendar";
import { flexi } from "./flexi";
import { interim } from "./interim";
import { overuren } from "./overuren";
import { student } from "./student";
import { telework } from "./telework";
import {
  MODULE_IDS,
  type FieldSpec,
  type MessageValue,
  type ModuleDefinition,
  type ModuleId,
} from "./types";

export const MODULES: readonly ModuleDefinition[] = [
  student,
  flexi,
  interim,
  overuren,
  telework,
];

export function isModuleId(value: unknown): value is ModuleId {
  return typeof value === "string" && (MODULE_IDS as readonly string[]).includes(value);
}

export function moduleById(id: ModuleId): ModuleDefinition {
  const found = MODULES.find((module) => module.id === id);
  if (found === undefined) throw new Error(`unknown module ${id}`);
  return found;
}

export function appliesTo(module: ModuleDefinition, statute: string): boolean {
  return (
    module.statutes === "all" ||
    (module.statutes as readonly string[]).includes(statute)
  );
}

/** An `org_modules` row as read through RLS. */
export interface OrgModuleRow {
  readonly module: string;
  readonly enabled: boolean;
  readonly config: unknown;
}

export interface EnabledModule {
  readonly module: ModuleDefinition;
  readonly config: unknown;
}

/** Enabled modules in registry order; unknown ids and switched-off rows are left out. */
export function enabledModules(rows: readonly OrgModuleRow[]): EnabledModule[] {
  const byId = new Map(rows.map((row) => [row.module, row]));
  return MODULES.flatMap((module) => {
    const row = byId.get(module.id);
    return row?.enabled ? [{ module, config: row.config }] : [];
  });
}

/** The enabled modules that apply to someone with this statute. */
export function modulesFor(
  enabled: readonly EnabledModule[],
  statute: string,
): EnabledModule[] {
  return enabled.filter(({ module }) => appliesTo(module, statute));
}

// Per-employee fields: form strings in, validated data out -------------------------------

const HOURS = /^\d{1,4}(?:[.,]\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type FieldsResult =
  | { readonly ok: true; readonly data: Record<string, unknown> }
  | { readonly ok: false; readonly invalid: readonly string[] };

/**
 * Turns the edit form's strings into the module's data and validates it with
 * the module's schema. Empty optional fields are left out. The database only
 * checks that the result is a small JSON object; the shape is checked here.
 */
export function fieldsFromForm(
  module: ModuleDefinition,
  values: Readonly<Record<string, unknown>>,
): FieldsResult {
  if (module.employeeFields === null) return { ok: false, invalid: [] };
  const invalid = new Set<string>();
  const data: Record<string, unknown> = {};
  for (const field of module.fields) {
    const raw = values[field.key];
    const text = typeof raw === "string" ? raw.trim() : "";
    if (text === "") {
      if (field.required) invalid.add(field.key);
      continue;
    }
    if (field.maxLength !== undefined && text.length > field.maxLength) {
      invalid.add(field.key);
      continue;
    }
    if (field.kind === "hours") {
      if (!HOURS.test(text)) invalid.add(field.key);
      else data[field.key] = Number(text.replace(",", "."));
    } else if (field.kind === "date") {
      if (!DATE.test(text)) invalid.add(field.key);
      else data[field.key] = text;
    } else {
      data[field.key] = text;
    }
  }
  if (invalid.size === 0) {
    const parsed = module.employeeFields.safeParse(data);
    if (parsed.success)
      return { ok: true, data: parsed.data as Record<string, unknown> };
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string") invalid.add(key);
    }
    // A rule over several fields with no path: blame every filled field.
    if (invalid.size === 0) for (const key of Object.keys(data)) invalid.add(key);
  }
  return { ok: false, invalid: [...invalid] };
}

/** Saved data back into form strings, for the edit form's first render. */
export function fieldsToForm(
  module: ModuleDefinition,
  data: unknown,
): Record<string, string> {
  const source =
    data !== null && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  const values: Record<string, string> = {};
  for (const field of module.fields) {
    const value = source[field.key];
    if (typeof value === "number") values[field.key] = String(value).replace(".", ",");
    else if (typeof value === "string") values[field.key] = value;
    else values[field.key] = "";
  }
  return values;
}

/** One saved field, ready to show; null when it is not filled in. */
export function fieldValue(field: FieldSpec, data: unknown): MessageValue | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const value = (data as Record<string, unknown>)[field.key];
  if (field.kind === "hours" && typeof value === "number") {
    return { durationMs: Math.round(value * HOUR_MS) };
  }
  if (field.kind === "date" && typeof value === "string" && DATE.test(value)) {
    return { day: value };
  }
  if (field.kind === "text" && typeof value === "string" && value !== "") return value;
  return null;
}

// Config: one choice per setting ------------------------------------------------------------

export type ConfigResult =
  | { readonly ok: true; readonly config: Record<string, unknown> }
  | { readonly ok: false };

/** A config from the detail page's choices, validated with the module's schema. */
export function configFromChoices(
  module: ModuleDefinition,
  values: Readonly<Record<string, unknown>>,
): ConfigResult {
  const config: Record<string, unknown> = {};
  for (const choice of module.configChoices) {
    const value = values[choice.key];
    if (value === undefined) continue;
    if (!choice.options.some((option) => option.value === value)) return { ok: false };
    config[choice.key] = value;
  }
  const parsed = module.configSchema.safeParse(config);
  return parsed.success
    ? { ok: true, config: parsed.data as Record<string, unknown> }
    : { ok: false };
}

/** The current value of each choice, with the first option as the default. */
export function currentChoices(
  module: ModuleDefinition,
  config: unknown,
): Record<string, string> {
  const source =
    config !== null && typeof config === "object" && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};
  const values: Record<string, string> = {};
  for (const choice of module.configChoices) {
    const value = source[choice.key];
    const known = choice.options.find((option) => option.value === value);
    values[choice.key] = known?.value ?? choice.options[0]?.value ?? "";
  }
  return values;
}
