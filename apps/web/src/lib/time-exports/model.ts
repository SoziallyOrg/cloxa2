import { isRecord, isTimestamp, isUuid } from "@/lib/corrections/model";
import { BELGIUM_TIME_ZONE } from "@/lib/time-clock/model";

export const TIME_EXPORT_SCHEMA = "cloxa.time-export.v1" as const;
export const TIME_EXPORT_SELECTION_RULE = "brussels-start-date.v1" as const;
export const MAX_EXPORT_ROWS = 10_000;
export const MAX_EXPORT_BYTES = 10 * 1024 * 1024;

const datePattern = /^\d{4}-\d{2}-\d{2}$/u;
const utcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u;
const localPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}[+-]\d{2}:\d{2}(?::\d{2})?$/u;
const durationPattern = /^(?:0|[1-9]\d{0,29})$/u;
const hashPattern = /^[0-9a-f]{64}$/u;

export type TimeExportBlocker =
  | "no_records"
  | "open_entry"
  | "pending_correction"
  | "row_limit"
  | "artifact_too_large";
export type TimeExportWarning = "missing_employee_code" | "missing_display_name";

export type TimeExportManifest = {
  schemaVersion: typeof TIME_EXPORT_SCHEMA;
  exportId: string;
  organizationId: string;
  worksiteId: string;
  timezone: typeof BELGIUM_TIME_ZONE;
  periodStartLocal: string;
  periodEndLocal: string;
  createdAtUtc: string;
  recordCount: number;
  employeeCount: number;
  totalDurationMicroseconds: string;
  datasetSha256: string;
  selectionRule: typeof TIME_EXPORT_SELECTION_RULE;
};

export type TimeExportRecord = {
  rowOrdinal: number;
  sourceTimeEntryId: string;
  sourceTimeEntryVersion: number;
  employeeCode: string | null;
  employeeDisplayName: string | null;
  worksiteId: string;
  worksiteName: string;
  startedAtUtc: string;
  endedAtUtc: string;
  startedAtBrussels: string;
  endedAtBrussels: string;
  durationMicroseconds: string;
  factualOrigin: "clock" | "approved_missed_entry";
  lastCorrectionRequestId: string | null;
};

export type TimeExportSnapshot = {
  manifest: TimeExportManifest;
  records: TimeExportRecord[];
};

export type TimeExportPreview = {
  timezone: typeof BELGIUM_TIME_ZONE;
  periodStartLocal: string;
  periodEndLocal: string;
  utcStartInclusive: string;
  utcEndExclusive: string;
  recordCount: number;
  employeeCount: number;
  totalDurationMicroseconds: string;
  blockers: TimeExportBlocker[];
  warnings: TimeExportWarning[];
  records: TimeExportRecord[];
};

export type ExportActionState = {
  status: "idle" | "success" | "error";
  message: string;
  preview?: TimeExportPreview;
  manifest?: TimeExportManifest;
};

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length && actual.every((key, i) => key === expected[i])
  );
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(`${value}T00:00:00Z`);
  return (
    year! > 0 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month! - 1 &&
    date.getUTCDate() === day
  );
}

function isDuration(value: unknown): value is string {
  return typeof value === "string" && durationPattern.test(value);
}

// Date's integer milliseconds are exact here; fractional seconds are parsed separately.
// Never pass elapsed microseconds through a JavaScript Number.
function utcMicroseconds(value: string): bigint | null {
  if (!utcPattern.test(value) || !isDate(value.slice(0, 10))) return null;
  const whole = `${value.slice(0, 19)}.000Z`;
  const milliseconds = Date.parse(whole);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== whole)
    return null;
  return BigInt(milliseconds) * 1000n + BigInt(value.slice(20, 26));
}

function matchesLocal(utc: string, local: string) {
  const localAsUtc = `${local.slice(0, 26)}Z`;
  const localMicros = utcMicroseconds(localAsUtc);
  const utcMicros = utcMicroseconds(utc);
  if (localMicros === null || utcMicros === null) return false;
  const hours = Number(local.slice(27, 29));
  const minutes = Number(local.slice(30, 32));
  const seconds = local.length === 35 ? Number(local.slice(33, 35)) : 0;
  if (
    hours > 23 ||
    minutes > 59 ||
    seconds > 59 ||
    (local.length === 35 && seconds === 0)
  )
    return false;
  const offset = BigInt((hours * 60 + minutes) * 60 + seconds) * 1_000_000n;
  if (localMicros - (local[26] === "-" ? -offset : offset) !== utcMicros) return false;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BELGIUM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utc));
  const part = (key: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === key)?.value;
  return (
    `${part("year")?.padStart(4, "0")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}` ===
    local.slice(0, 19)
  );
}

function parseManifest(value: unknown): TimeExportManifest | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schema_version",
      "export_id",
      "organization_id",
      "worksite_id",
      "timezone",
      "period_start_local",
      "period_end_local",
      "created_at_utc",
      "record_count",
      "employee_count",
      "total_duration_microseconds",
      "dataset_sha256",
      "selection_rule",
    ]) ||
    value.schema_version !== TIME_EXPORT_SCHEMA ||
    !isUuid(value.export_id) ||
    !isUuid(value.organization_id) ||
    !isUuid(value.worksite_id) ||
    value.timezone !== BELGIUM_TIME_ZONE ||
    !isDate(value.period_start_local) ||
    !isDate(value.period_end_local) ||
    !isValidExportPeriod(
      value.period_start_local,
      value.period_end_local,
      value.period_end_local,
    ) ||
    !utcPattern.test(String(value.created_at_utc)) ||
    !isTimestamp(value.created_at_utc) ||
    utcMicroseconds(value.created_at_utc) === null ||
    !Number.isSafeInteger(value.record_count) ||
    (value.record_count as number) < 1 ||
    (value.record_count as number) > MAX_EXPORT_ROWS ||
    !Number.isSafeInteger(value.employee_count) ||
    (value.employee_count as number) < 1 ||
    (value.employee_count as number) > (value.record_count as number) ||
    !isDuration(value.total_duration_microseconds) ||
    BigInt(value.total_duration_microseconds) <= 0n ||
    typeof value.dataset_sha256 !== "string" ||
    !hashPattern.test(value.dataset_sha256) ||
    value.selection_rule !== TIME_EXPORT_SELECTION_RULE
  )
    return null;
  return {
    schemaVersion: value.schema_version,
    exportId: value.export_id,
    organizationId: value.organization_id,
    worksiteId: value.worksite_id,
    timezone: value.timezone,
    periodStartLocal: value.period_start_local,
    periodEndLocal: value.period_end_local,
    createdAtUtc: value.created_at_utc as string,
    recordCount: value.record_count as number,
    employeeCount: value.employee_count as number,
    totalDurationMicroseconds: value.total_duration_microseconds,
    datasetSha256: value.dataset_sha256,
    selectionRule: value.selection_rule,
  };
}

const recordKeys = [
  "row_ordinal",
  "source_time_entry_id",
  "source_time_entry_version",
  "employee_code",
  "employee_display_name",
  "worksite_id",
  "worksite_name",
  "started_at_utc",
  "ended_at_utc",
  "started_at_brussels",
  "ended_at_brussels",
  "duration_microseconds",
  "factual_origin",
  "last_correction_request_id",
] as const;

function parseRecord(value: unknown): TimeExportRecord | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, recordKeys) ||
    !Number.isSafeInteger(value.row_ordinal) ||
    (value.row_ordinal as number) < 1 ||
    (value.row_ordinal as number) > MAX_EXPORT_ROWS ||
    !isUuid(value.source_time_entry_id) ||
    !Number.isSafeInteger(value.source_time_entry_version) ||
    (value.source_time_entry_version as number) < 1 ||
    !(value.employee_code === null || typeof value.employee_code === "string") ||
    !(
      value.employee_display_name === null ||
      typeof value.employee_display_name === "string"
    ) ||
    !isUuid(value.worksite_id) ||
    typeof value.worksite_name !== "string" ||
    !value.worksite_name ||
    typeof value.started_at_utc !== "string" ||
    !utcPattern.test(value.started_at_utc) ||
    !isTimestamp(value.started_at_utc) ||
    typeof value.ended_at_utc !== "string" ||
    !utcPattern.test(value.ended_at_utc) ||
    !isTimestamp(value.ended_at_utc) ||
    typeof value.started_at_brussels !== "string" ||
    !localPattern.test(value.started_at_brussels) ||
    typeof value.ended_at_brussels !== "string" ||
    !localPattern.test(value.ended_at_brussels) ||
    !isDuration(value.duration_microseconds) ||
    BigInt(value.duration_microseconds) <= 0n ||
    !["clock", "approved_missed_entry"].includes(String(value.factual_origin)) ||
    !(
      value.last_correction_request_id === null ||
      isUuid(value.last_correction_request_id)
    )
  )
    return null;
  const started = utcMicroseconds(value.started_at_utc);
  const ended = utcMicroseconds(value.ended_at_utc);
  if (
    started === null ||
    ended === null ||
    ended - started !== BigInt(value.duration_microseconds) ||
    !matchesLocal(value.started_at_utc, value.started_at_brussels) ||
    !matchesLocal(value.ended_at_utc, value.ended_at_brussels)
  )
    return null;
  return {
    rowOrdinal: value.row_ordinal as number,
    sourceTimeEntryId: value.source_time_entry_id,
    sourceTimeEntryVersion: value.source_time_entry_version as number,
    employeeCode: value.employee_code,
    employeeDisplayName: value.employee_display_name,
    worksiteId: value.worksite_id,
    worksiteName: value.worksite_name,
    startedAtUtc: value.started_at_utc,
    endedAtUtc: value.ended_at_utc,
    startedAtBrussels: value.started_at_brussels,
    endedAtBrussels: value.ended_at_brussels,
    durationMicroseconds: value.duration_microseconds,
    factualOrigin: value.factual_origin as TimeExportRecord["factualOrigin"],
    lastCorrectionRequestId: value.last_correction_request_id,
  };
}

export function parseTimeExportSnapshot(value: unknown): TimeExportSnapshot | null {
  if (!isRecord(value) || !hasExactKeys(value, ["manifest", "records"])) return null;
  const manifest = parseManifest(value.manifest);
  if (
    !manifest ||
    !Array.isArray(value.records) ||
    value.records.length !== manifest.recordCount
  )
    return null;
  const records = value.records.map(parseRecord);
  if (records.some((record) => record === null)) return null;
  const safeRecords = records as TimeExportRecord[];
  if (
    safeRecords.some(
      (record, index) =>
        record.rowOrdinal !== index + 1 ||
        record.worksiteId !== manifest.worksiteId ||
        record.startedAtBrussels.slice(0, 10) < manifest.periodStartLocal ||
        record.startedAtBrussels.slice(0, 10) > manifest.periodEndLocal,
    ) ||
    new Set(safeRecords.map((record) => record.sourceTimeEntryId)).size !==
      safeRecords.length ||
    safeRecords.reduce(
      (total, record) => total + BigInt(record.durationMicroseconds),
      0n,
    ) !== BigInt(manifest.totalDurationMicroseconds)
  )
    return null;
  return { manifest, records: safeRecords };
}

export function parseTimeExportManifest(value: unknown) {
  return parseManifest(value);
}

export function parseTimeExportHistory(value: unknown): TimeExportManifest[] | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["exports"]) ||
    !Array.isArray(value.exports) ||
    value.exports.length > 20
  )
    return null;
  const exports = value.exports.map(parseManifest);
  if (
    exports.some((item) => item === null) ||
    new Set(exports.map((item) => item?.exportId)).size !== exports.length
  )
    return null;
  return exports as TimeExportManifest[];
}

export function parseTimeExportPreview(value: unknown): TimeExportPreview | null {
  const blockerValues = new Set<TimeExportBlocker>([
    "no_records",
    "open_entry",
    "pending_correction",
    "row_limit",
    "artifact_too_large",
  ]);
  const warningValues = new Set<TimeExportWarning>([
    "missing_employee_code",
    "missing_display_name",
  ]);
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "timezone",
      "period_start_local",
      "period_end_local",
      "utc_start_inclusive",
      "utc_end_exclusive",
      "record_count",
      "employee_count",
      "total_duration_microseconds",
      "blockers",
      "warnings",
      "records",
    ]) ||
    value.timezone !== BELGIUM_TIME_ZONE ||
    !isDate(value.period_start_local) ||
    !isDate(value.period_end_local) ||
    !isValidExportPeriod(
      value.period_start_local,
      value.period_end_local,
      value.period_end_local,
    ) ||
    typeof value.utc_start_inclusive !== "string" ||
    !utcPattern.test(value.utc_start_inclusive) ||
    typeof value.utc_end_exclusive !== "string" ||
    !utcPattern.test(value.utc_end_exclusive) ||
    !Number.isSafeInteger(value.record_count) ||
    (value.record_count as number) < 0 ||
    !Number.isSafeInteger(value.employee_count) ||
    (value.employee_count as number) < 0 ||
    (value.employee_count as number) > (value.record_count as number) ||
    !isDuration(value.total_duration_microseconds) ||
    !Array.isArray(value.blockers) ||
    !value.blockers.every((item) => blockerValues.has(item as TimeExportBlocker)) ||
    new Set(value.blockers).size !== value.blockers.length ||
    !Array.isArray(value.warnings) ||
    !value.warnings.every((item) => warningValues.has(item as TimeExportWarning)) ||
    new Set(value.warnings).size !== value.warnings.length ||
    !Array.isArray(value.records) ||
    value.records.length > MAX_EXPORT_ROWS
  )
    return null;
  const records = value.records.map(parseRecord);
  if (records.some((record) => record === null)) return null;
  const safeRecords = records as TimeExportRecord[];
  const omitted =
    value.blockers.includes("row_limit") ||
    value.blockers.includes("artifact_too_large");
  if (
    (!omitted &&
      (safeRecords.length !== value.record_count ||
        safeRecords.reduce(
          (total, record) => total + BigInt(record.durationMicroseconds),
          0n,
        ) !== BigInt(value.total_duration_microseconds))) ||
    safeRecords.some((record, index) => record.rowOrdinal !== index + 1)
  )
    return null;
  return {
    timezone: value.timezone,
    periodStartLocal: value.period_start_local,
    periodEndLocal: value.period_end_local,
    utcStartInclusive: value.utc_start_inclusive,
    utcEndExclusive: value.utc_end_exclusive,
    recordCount: value.record_count as number,
    employeeCount: value.employee_count as number,
    totalDurationMicroseconds: value.total_duration_microseconds,
    blockers: value.blockers as TimeExportBlocker[],
    warnings: value.warnings as TimeExportWarning[],
    records: safeRecords,
  };
}

export function isLocalDate(value: unknown): value is string {
  return isDate(value);
}

export function isValidExportPeriod(start: string, end: string, today: string) {
  if (!isDate(start) || !isDate(end) || !isDate(today) || end < start || end > today)
    return false;
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return (endMs - startMs) / 86_400_000 <= 30;
}

export function formatExactDuration(microseconds: string) {
  const total = BigInt(microseconds);
  const hours = total / 3_600_000_000n;
  const minutes = (total / 60_000_000n) % 60n;
  const seconds = (total / 1_000_000n) % 60n;
  const fraction = total % 1_000_000n;
  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}.${fraction.toString().padStart(6, "0")}`;
}
