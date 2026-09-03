import type { TimeExportSnapshot } from "@/lib/time-exports/model";

export const manifestWire = {
  schema_version: "cloxa.time-export.v1",
  export_id: "10000000-0000-4000-8000-000000000001",
  organization_id: "20000000-0000-4000-8000-000000000001",
  worksite_id: "30000000-0000-4000-8000-000000000001",
  timezone: "Europe/Brussels",
  period_start_local: "2010-10-31",
  period_end_local: "2010-10-31",
  created_at_utc: "2010-11-01T12:00:00.123456Z",
  record_count: 1,
  employee_count: 1,
  total_duration_microseconds: "7200000001",
  dataset_sha256: "a".repeat(64),
  selection_rule: "brussels-start-date.v1",
} as const;

export const recordWire = {
  row_ordinal: 1,
  source_time_entry_id: "40000000-0000-4000-8000-000000000001",
  source_time_entry_version: 2,
  employee_code: "SYN-1",
  employee_display_name: "Fictieve medewerker",
  worksite_id: manifestWire.worksite_id,
  worksite_name: "Fictieve werkplek",
  started_at_utc: "2010-10-31T00:30:00.123456Z",
  ended_at_utc: "2010-10-31T02:30:00.123457Z",
  started_at_brussels: "2010-10-31T02:30:00.123456+02:00",
  ended_at_brussels: "2010-10-31T03:30:00.123457+01:00",
  duration_microseconds: "7200000001",
  factual_origin: "clock",
  last_correction_request_id: null,
} as const;

export const snapshotWire = { manifest: manifestWire, records: [recordWire] };

export const snapshot: TimeExportSnapshot = {
  manifest: {
    schemaVersion: manifestWire.schema_version,
    exportId: manifestWire.export_id,
    organizationId: manifestWire.organization_id,
    worksiteId: manifestWire.worksite_id,
    timezone: manifestWire.timezone,
    periodStartLocal: manifestWire.period_start_local,
    periodEndLocal: manifestWire.period_end_local,
    createdAtUtc: manifestWire.created_at_utc,
    recordCount: manifestWire.record_count,
    employeeCount: manifestWire.employee_count,
    totalDurationMicroseconds: manifestWire.total_duration_microseconds,
    datasetSha256: manifestWire.dataset_sha256,
    selectionRule: manifestWire.selection_rule,
  },
  records: [
    {
      rowOrdinal: recordWire.row_ordinal,
      sourceTimeEntryId: recordWire.source_time_entry_id,
      sourceTimeEntryVersion: recordWire.source_time_entry_version,
      employeeCode: recordWire.employee_code,
      employeeDisplayName: recordWire.employee_display_name,
      worksiteId: recordWire.worksite_id,
      worksiteName: recordWire.worksite_name,
      startedAtUtc: recordWire.started_at_utc,
      endedAtUtc: recordWire.ended_at_utc,
      startedAtBrussels: recordWire.started_at_brussels,
      endedAtBrussels: recordWire.ended_at_brussels,
      durationMicroseconds: recordWire.duration_microseconds,
      factualOrigin: recordWire.factual_origin,
      lastCorrectionRequestId: recordWire.last_correction_request_id,
    },
  ],
};
