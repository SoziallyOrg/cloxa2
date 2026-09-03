import { createHash } from "node:crypto";
import { MAX_EXPORT_BYTES, type TimeExportSnapshot } from "@/lib/time-exports/model";

export type TimeExportFormat = "csv" | "json";

function wireManifest(manifest: TimeExportSnapshot["manifest"]) {
  return {
    schema_version: manifest.schemaVersion,
    export_id: manifest.exportId,
    organization_id: manifest.organizationId,
    worksite_id: manifest.worksiteId,
    timezone: manifest.timezone,
    period_start_local: manifest.periodStartLocal,
    period_end_local: manifest.periodEndLocal,
    created_at_utc: manifest.createdAtUtc,
    record_count: manifest.recordCount,
    employee_count: manifest.employeeCount,
    total_duration_microseconds: manifest.totalDurationMicroseconds,
    dataset_sha256: manifest.datasetSha256,
    selection_rule: manifest.selectionRule,
  };
}

function wireRecord(record: TimeExportSnapshot["records"][number]) {
  return {
    row_ordinal: record.rowOrdinal,
    source_time_entry_id: record.sourceTimeEntryId,
    source_time_entry_version: record.sourceTimeEntryVersion,
    employee_code: record.employeeCode,
    employee_display_name: record.employeeDisplayName,
    worksite_id: record.worksiteId,
    worksite_name: record.worksiteName,
    started_at_utc: record.startedAtUtc,
    ended_at_utc: record.endedAtUtc,
    started_at_brussels: record.startedAtBrussels,
    ended_at_brussels: record.endedAtBrussels,
    duration_microseconds: record.durationMicroseconds,
    factual_origin: record.factualOrigin,
    last_correction_request_id: record.lastCorrectionRequestId,
  };
}

// v1 canonical form: PostgreSQL jsonb text. All object keys are fixed ASCII names:
// byte-length order, then byte order; comma-space and colon-space separators.
// Numbers are bounded integer ordinals/counts/versions; durations remain strings.
function canonicalJsonb(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJsonb).join(", ")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort(
      (a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0),
    );
    return `{${keys.map((key) => `${JSON.stringify(key)}: ${canonicalJsonb(record[key])}`).join(", ")}}`;
  }
  return JSON.stringify(value);
}

export function computeDatasetSha256(snapshot: TimeExportSnapshot) {
  const manifest: Record<string, unknown> = wireManifest(snapshot.manifest);
  delete manifest.dataset_sha256;
  return createHash("sha256")
    .update(
      canonicalJsonb({
        manifest,
        records: [...snapshot.records]
          .sort((a, b) => a.rowOrdinal - b.rowOrdinal)
          .map(wireRecord),
      }),
      "utf8",
    )
    .digest("hex");
}

export function serializeTimeExportJson(snapshot: TimeExportSnapshot) {
  const records = [...snapshot.records].sort(
    (left, right) => left.rowOrdinal - right.rowOrdinal,
  );
  return `${JSON.stringify({
    manifest: wireManifest(snapshot.manifest),
    records: records.map(wireRecord),
  })}\n`;
}

/** Prefix leading Unicode whitespace, control/format character, or formula marker. */
export function neutralizeSpreadsheetCell(value: string) {
  return /^[\s\p{Cc}\p{Cf}=+\-@]/u.test(value) ? `'${value}` : value;
}

function csv(value: string | number | null) {
  const text = value === null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

const csvColumns = [
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
  "row_ordinal",
  "source_time_entry_id",
  "source_time_entry_version",
  "employee_code",
  "employee_display_name",
  "worksite_name",
  "started_at_utc",
  "ended_at_utc",
  "started_at_brussels",
  "ended_at_brussels",
  "duration_microseconds",
  "factual_origin",
  "last_correction_request_id",
] as const;

export function serializeTimeExportCsv(snapshot: TimeExportSnapshot) {
  const manifest = wireManifest(snapshot.manifest);
  const lines = [csvColumns.map(csv).join(",")];
  for (const record of [...snapshot.records].sort(
    (left, right) => left.rowOrdinal - right.rowOrdinal,
  )) {
    const row = wireRecord(record);
    lines.push(
      [
        manifest.schema_version,
        manifest.export_id,
        manifest.organization_id,
        manifest.worksite_id,
        manifest.timezone,
        manifest.period_start_local,
        manifest.period_end_local,
        manifest.created_at_utc,
        manifest.record_count,
        manifest.employee_count,
        manifest.total_duration_microseconds,
        manifest.dataset_sha256,
        manifest.selection_rule,
        row.row_ordinal,
        row.source_time_entry_id,
        row.source_time_entry_version,
        row.employee_code === null
          ? null
          : neutralizeSpreadsheetCell(row.employee_code),
        row.employee_display_name === null
          ? null
          : neutralizeSpreadsheetCell(row.employee_display_name),
        neutralizeSpreadsheetCell(row.worksite_name),
        row.started_at_utc,
        row.ended_at_utc,
        row.started_at_brussels,
        row.ended_at_brussels,
        row.duration_microseconds,
        row.factual_origin,
        row.last_correction_request_id,
      ]
        .map(csv)
        .join(","),
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function safeExportFilename(
  snapshot: TimeExportSnapshot,
  format: TimeExportFormat,
) {
  return `cloxa-time-export_${snapshot.manifest.periodStartLocal}_${snapshot.manifest.periodEndLocal}_${snapshot.manifest.exportId.slice(0, 8)}.${format}`;
}

export function createTimeExportArtifact(
  snapshot: TimeExportSnapshot,
  format: TimeExportFormat,
) {
  const text =
    format === "csv"
      ? serializeTimeExportCsv(snapshot)
      : serializeTimeExportJson(snapshot);
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > MAX_EXPORT_BYTES) return null;
  return {
    bytes,
    filename: safeExportFilename(snapshot, format),
    contentType:
      format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
