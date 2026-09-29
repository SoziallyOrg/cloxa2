/**
 * The module contract (ADR 008). A module only reads facts (shifts derived
 * by `@cloxa/domain`, planned blocks) and adds information: factual,
 * indicative counters, calm hints and export columns. It never blocks
 * clocking and never changes a fact. No I/O: callers load, modules compute.
 *
 * Copy is always an i18n key plus values, so nothing here claims a legal
 * outcome in its own words. Durations, times and dates travel as tagged
 * values the UI formats (`{ durationMs }`, `{ time }`, `{ day }`, `{ month }`).
 */
import type { PlannedBlock, Shift } from "@cloxa/domain";
import type { CatalogKey } from "@cloxa/i18n";
import type { z } from "zod";

export const MODULE_IDS = [
  "student",
  "flexi",
  "interim",
  "overuren",
  "telework",
] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

export const STATUTES = [
  "bediende",
  "arbeider",
  "student",
  "flexi",
  "interim",
  "other",
] as const;
export type Statute = (typeof STATUTES)[number];

/** A value the UI turns into text. */
export type MessageValue =
  | string
  | number
  | { readonly durationMs: number }
  /** Epoch milliseconds, shown as a Brussels time ("08:02"). */
  | { readonly time: number }
  /** A Brussels day `YYYY-MM-DD`, shown short ("ma 28 sep"). */
  | { readonly day: string }
  /** A calendar month `YYYY-MM`, shown as "september 2026". */
  | { readonly month: string };

export interface Message {
  readonly key: CatalogKey;
  readonly values?: Readonly<Record<string, MessageValue>>;
}

/** A planned block with the Brussels day it is planned on (overnight: its start day). */
export interface PlannedDayBlock extends PlannedBlock {
  readonly day: string;
}

/** Inclusive Brussels days, plus "now" for a shift still running. */
export interface Period {
  readonly from: string;
  readonly to: string;
  readonly now: number;
}

export type Audience = "employee" | "manager";

export interface ModuleInput {
  /** One employee's shifts, from effective events (`deriveShifts`). */
  readonly shifts: readonly Shift[];
  /**
   * That employee's planned blocks. May reach past `period.to` (the student
   * quarters count the whole quarter's planning).
   */
  readonly planned: readonly PlannedDayBlock[];
  readonly period: Period;
  /** Raw `org_modules.config`; each module parses it with its own defaults. */
  readonly config: unknown;
  /** Raw `employee_module_data.data`, or null when nothing was saved. */
  readonly data: unknown;
  readonly audience: Audience;
}

export interface Counter {
  readonly id: string;
  /**
   * `figure`: a big number with an optional progress track and lines.
   * `row`: one list row, label left and value right.
   * `lines`: a small heading with plain lines under it.
   */
  readonly display: "figure" | "row" | "lines";
  readonly label: Message;
  readonly value?: Message;
  readonly progress?: {
    readonly value: number;
    readonly max: number;
    readonly label: Message;
    readonly start: Message;
    readonly end: Message;
  };
  readonly lines?: readonly Message[];
}

export interface Hint {
  readonly id: string;
  /** `attention` shows in the attention colour, with the words saying why. */
  readonly tone: "info" | "attention";
  readonly message: Message;
}

export type FieldKind = "text" | "hours" | "date";

/** One per-employee field, for the edit form. */
export interface FieldSpec {
  readonly key: string;
  readonly kind: FieldKind;
  readonly label: CatalogKey;
  readonly hint?: CatalogKey;
  readonly required: boolean;
  readonly maxLength?: number;
}

/** One choice setting of a module (e.g. the overuren sector). */
export interface ConfigChoice {
  readonly key: string;
  readonly label: CatalogKey;
  readonly footer?: CatalogKey;
  readonly options: readonly {
    readonly value: string;
    readonly label: CatalogKey;
    readonly detail?: CatalogKey;
  }[];
}

export type ExportValue = string | number | boolean | null;

export interface ExportColumn {
  /** The key inside the row's `modules.<id>` object. Stable: part of the export format. */
  readonly key: string;
  readonly header: CatalogKey;
  /** How the CSV writes it: text as is, durations as decimal hours, counts, ja/nee. */
  readonly kind: "text" | "duration" | "count" | "boolean";
}

/** What one employee-day row of an export sees. */
export interface ExportDayInput {
  readonly day: string;
  /** Shifts that started on this day. */
  readonly shifts: readonly Shift[];
  readonly planned: readonly PlannedBlock[];
  readonly config: unknown;
  readonly data: unknown;
  /**
   * Net worked from 1 January of this day's year up to and including this
   * day; only computed for modules with `needsYearToDate`, null otherwise.
   */
  readonly yearToDateNetMs: number | null;
}

export interface ModuleDefinition {
  readonly id: ModuleId;
  readonly label: CatalogKey;
  readonly description: CatalogKey;
  /** The statutes it applies to; `all` for everyone. */
  readonly statutes: readonly Statute[] | "all";
  /** Settings shown on the module's detail page. */
  readonly configChoices: readonly ConfigChoice[];
  /** Strict shape of `org_modules.config`. */
  readonly configSchema: z.ZodType;
  /** Strict shape of `employee_module_data.data`, or null when there are no fields. */
  readonly employeeFields: z.ZodType | null;
  readonly fields: readonly FieldSpec[];
  /** The export needs each row's year-to-date net time. */
  readonly needsYearToDate: boolean;
  counters(input: ModuleInput): readonly Counter[];
  hints(input: ModuleInput): readonly Hint[];
  readonly exportColumns: readonly ExportColumn[];
  exportValues(input: ExportDayInput): Readonly<Record<string, ExportValue>>;
}
