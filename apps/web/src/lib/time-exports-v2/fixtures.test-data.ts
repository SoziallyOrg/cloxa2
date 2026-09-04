import { manifestWire, recordWire } from "@/lib/time-exports/fixtures.test-data";
import type { V2Snapshot } from "./model";
import { v2DatasetHash } from "./serializer";
const { total_duration_microseconds, ...manifest } = manifestWire;
const { duration_microseconds, ...record } = recordWire;
export const v2: V2Snapshot = {
  manifest: {
    ...manifest,
    schema_version: "cloxa.time-export.v2",
    total_gross_duration_microseconds: total_duration_microseconds,
    total_unpaid_break_duration_microseconds: "1000001",
    total_net_worked_duration_microseconds: "7199000000",
  },
  records: [
    {
      ...record,
      gross_duration_microseconds: duration_microseconds,
      unpaid_break_duration_microseconds: "1000001",
      net_worked_duration_microseconds: "7199000000",
      effective_break_count: 1,
      breaks: [
        {
          logical_break_id: manifest.export_id,
          version: 1,
          revision_id: record.source_time_entry_id,
          started_at_utc: "2010-10-31T00:45:00.123456Z",
          ended_at_utc: "2010-10-31T00:45:01.123457Z",
          origin: "approved_missed_break",
        },
      ],
    },
  ],
};
v2.manifest.dataset_sha256 = v2DatasetHash(v2);
