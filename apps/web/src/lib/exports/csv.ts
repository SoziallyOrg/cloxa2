/**
 * CSV rendering of a `cloxa.export.v1` snapshot, for Belgian (nl-BE) Excel:
 * UTF-8 with BOM, `;` as separator, CRLF line ends, decimal comma. Fully
 * determined by the snapshot: the same JSON always gives the same bytes.
 *
 * One line per shift; a day with planned time but no shift gets one line
 * without shift columns. Day totals (planned, deviation) sit on the first
 * line of each day only, so summing a column never counts a day twice.
 *
 * Module columns (ADR 008) follow, only for the modules the export lists.
 * Durations and counts are day totals too (first line only); text and ja/nee
 * repeat on every line, so filtering on them keeps the whole day.
 */
import { t, type CatalogKey } from "@cloxa/i18n";
import { MODULES, type ExportColumn, type ModuleId } from "@cloxa/modules";

import type { ExportContent, ExportRow, ExportShift } from "./content";

const BOM = "﻿";
const SEPARATOR = ";";
const EOL = "\r\n";

const HEADER_KEYS: readonly CatalogKey[] = [
  "exports.csv.day",
  "exports.csv.employeeCode",
  "exports.csv.employeeName",
  "exports.csv.site",
  "exports.csv.startLocal",
  "exports.csv.endLocal",
  "exports.csv.startUtc",
  "exports.csv.endUtc",
  "exports.csv.breakMinutes",
  "exports.csv.grossMinutes",
  "exports.csv.netMinutes",
  "exports.csv.netHours",
  "exports.csv.plannedMinutes",
  "exports.csv.plannedHours",
  "exports.csv.deviationMinutes",
  "exports.csv.deviationHours",
  "exports.csv.edited",
  "exports.csv.open",
];

/**
 * Spreadsheets run cells that start with `=`, `+`, `-` or `@` (and some
 * control or whitespace characters) as formulas. Prefixing an apostrophe
 * shows the text as typed. Only for free text (names, codes, sites): the
 * numbers we write ourselves must stay numbers.
 */
export function neutralizeSpreadsheetCell(value: string): string {
  return /^[\s\p{Cc}\p{Cf}=+\-@]/u.test(value) ? `'${value}` : value;
}

function quote(value: string): string {
  return /[";\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function text(value: string | null): string {
  return value === null ? "" : quote(neutralizeSpreadsheetCell(value));
}

/** Whole minutes, rounded half away from zero, so -90.5 and 90.5 mirror each other. */
export function minutesOf(ms: number): number {
  const minutes = Math.sign(ms) * Math.round(Math.abs(ms) / 60_000);
  return minutes === 0 ? 0 : minutes;
}

/** Decimal hours with a comma and two decimals, from whole minutes: 90 -> "1,50". */
export function hoursOf(minutes: number): string {
  return (minutes / 60).toFixed(2).replace(".", ",");
}

/** `2026-10-25T02:30:00+01:00` -> `2026-10-25 02:30`. */
function localCell(iso: string | null): string {
  return iso === null ? "" : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function yesNo(value: boolean): string {
  return t(value ? "exports.csv.yes" : "exports.csv.no");
}

interface ModuleColumn {
  readonly module: ModuleId;
  readonly column: ExportColumn;
}

/** The module columns of this export, in registry order. */
function moduleColumns(content: ExportContent): ModuleColumn[] {
  const listed = new Set<string>(content.modules ?? []);
  return MODULES.filter((module) => listed.has(module.id)).flatMap((module) =>
    module.exportColumns.map((column) => ({ module: module.id, column })),
  );
}

function moduleCell(
  row: ExportRow,
  { module, column }: ModuleColumn,
  withDayTotals: boolean,
): string {
  const value = row.modules?.[module]?.[column.key] ?? null;
  if (value === null) return "";
  switch (column.kind) {
    case "text":
      return typeof value === "string" ? text(value) : "";
    case "boolean":
      return typeof value === "boolean" ? yesNo(value) : "";
    case "duration":
      return withDayTotals && typeof value === "number"
        ? hoursOf(minutesOf(value))
        : "";
    case "count":
      return withDayTotals && typeof value === "number" ? String(value) : "";
  }
}

function line(
  row: ExportRow,
  shift: ExportShift | null,
  withDayTotals: boolean,
  modules: readonly ModuleColumn[],
): string {
  const planned = minutesOf(row.planned_ms);
  const deviation = minutesOf(row.deviation_ms);
  const net = shift === null ? null : minutesOf(shift.net_ms);
  const cells = [
    row.day,
    text(row.employee_code),
    text(row.employee_name),
    shift === null ? "" : text(shift.site_name),
    shift === null ? "" : localCell(shift.start_local),
    shift === null ? "" : localCell(shift.end_local),
    shift?.start_utc ?? "",
    shift?.end_utc ?? "",
    shift === null ? "" : String(minutesOf(shift.break_ms)),
    shift === null ? "" : String(minutesOf(shift.gross_ms)),
    net === null ? "" : String(net),
    net === null ? "" : hoursOf(net),
    withDayTotals ? String(planned) : "",
    withDayTotals ? hoursOf(planned) : "",
    withDayTotals ? String(deviation) : "",
    withDayTotals ? hoursOf(deviation) : "",
    shift === null ? yesNo(row.edited) : yesNo(shift.edited),
    shift === null ? "" : yesNo(shift.open),
    ...modules.map((column) => moduleCell(row, column, withDayTotals)),
  ];
  return cells.join(SEPARATOR);
}

export function serializeExportCsv(content: ExportContent): string {
  const modules = moduleColumns(content);
  const header = [
    ...HEADER_KEYS.map((key) => t(key)),
    ...modules.map(({ column }) => t(column.header)),
  ];
  const lines = [header.map(quote).join(SEPARATOR)];
  for (const row of content.rows) {
    if (row.shifts.length === 0) {
      lines.push(line(row, null, true, modules));
      continue;
    }
    row.shifts.forEach((shift, index) => {
      lines.push(line(row, shift, index === 0, modules));
    });
  }
  return `${BOM}${lines.join(EOL)}${EOL}`;
}
