import { z } from "zod";
import { uuid, version, instant } from "@/lib/break-corrections/model";
import { exactMicroseconds } from "@/lib/time-clock/breaks";
import {
  parseTimeExportManifest,
  parseTimeExportSnapshot,
  isValidExportPeriod,
} from "@/lib/time-exports/model";

const duration = z.string().regex(/^(0|[1-9]\d{0,29})$/u);
const utc = instant.refine((v) =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(v),
);
const count = z.number().int().nonnegative().max(10000);
const pause = z
  .object({
    logical_break_id: uuid,
    version,
    revision_id: uuid.nullable(),
    started_at_utc: utc,
    ended_at_utc: utc,
    origin: z.enum(["live", "approved_missed_break"]),
  })
  .strict();
export const recordSchema = z
  .object({
    row_ordinal: count,
    source_time_entry_id: uuid,
    source_time_entry_version: version,
    employee_code: z.string().nullable(),
    employee_display_name: z.string().nullable(),
    worksite_id: uuid,
    worksite_name: z.string().min(1),
    started_at_utc: utc,
    ended_at_utc: utc,
    started_at_brussels: z.string(),
    ended_at_brussels: z.string(),
    gross_duration_microseconds: duration,
    unpaid_break_duration_microseconds: duration,
    net_worked_duration_microseconds: duration,
    effective_break_count: count,
    breaks: z.array(pause),
    factual_origin: z.enum(["clock", "approved_missed_entry"]),
    last_correction_request_id: uuid.nullable(),
  })
  .strict()
  .refine((r) => {
    let end = exactMicroseconds(r.started_at_utc),
      total = 0n;
    if (
      r.breaks.length !== r.effective_break_count ||
      new Set(r.breaks.map((b) => b.logical_break_id)).size !== r.breaks.length
    )
      return false;
    for (const b of r.breaks) {
      const start = exactMicroseconds(b.started_at_utc),
        next = exactMicroseconds(b.ended_at_utc);
      if (
        start < end ||
        next <= start ||
        next > exactMicroseconds(r.ended_at_utc) ||
        (b.revision_id === null && (b.origin !== "live" || b.version !== 2))
      )
        return false;
      total += next - start;
      end = next;
    }
    return (
      exactMicroseconds(r.ended_at_utc) - exactMicroseconds(r.started_at_utc) ===
        BigInt(r.gross_duration_microseconds) &&
      total === BigInt(r.unpaid_break_duration_microseconds) &&
      BigInt(r.gross_duration_microseconds) - total ===
        BigInt(r.net_worked_duration_microseconds)
    );
  });
const manifestSchema = z
  .object({
    schema_version: z.literal("cloxa.time-export.v2"),
    export_id: uuid,
    organization_id: uuid,
    worksite_id: uuid,
    timezone: z.literal("Europe/Brussels"),
    period_start_local: z.string(),
    period_end_local: z.string(),
    created_at_utc: utc,
    record_count: count,
    employee_count: count,
    total_gross_duration_microseconds: duration,
    total_unpaid_break_duration_microseconds: duration,
    total_net_worked_duration_microseconds: duration,
    dataset_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    selection_rule: z.literal("brussels-start-date.v1"),
  })
  .strict();
export type V2Manifest = z.infer<typeof manifestSchema>;
export type V2Record = z.infer<typeof recordSchema>;
export type V2Snapshot = { manifest: V2Manifest; records: V2Record[] };
function legacyManifest(m: V2Manifest) {
  const {
    total_gross_duration_microseconds,
    total_unpaid_break_duration_microseconds: _break,
    total_net_worked_duration_microseconds: _net,
    ...base
  } = m;
  void _break;
  void _net;
  return {
    ...base,
    schema_version: "cloxa.time-export.v1",
    total_duration_microseconds: total_gross_duration_microseconds,
  };
}
function legacyRecord(r: V2Record) {
  const {
    gross_duration_microseconds,
    unpaid_break_duration_microseconds: _break,
    net_worked_duration_microseconds: _net,
    effective_break_count: _count,
    breaks: _breaks,
    ...base
  } = r;
  void _break;
  void _net;
  void _count;
  void _breaks;
  return { ...base, duration_microseconds: gross_duration_microseconds };
}
export function parseV2Manifest(value: unknown) {
  const p = manifestSchema.safeParse(value);
  if (!p.success || !parseTimeExportManifest(legacyManifest(p.data))) return null;
  const m = p.data;
  return BigInt(m.total_gross_duration_microseconds) -
    BigInt(m.total_unpaid_break_duration_microseconds) ===
    BigInt(m.total_net_worked_duration_microseconds)
    ? m
    : null;
}
const snapshotSchema = z
  .object({
    request_id: uuid,
    manifest: manifestSchema,
    records: z.array(recordSchema).max(10000),
  })
  .strict();
export function parseV2Snapshot(value: unknown, requestId: string): V2Snapshot | null {
  const p = snapshotSchema.safeParse(value);
  if (!p.success || p.data.request_id !== requestId) return null;
  const { manifest: m, records } = p.data;
  if (
    !parseV2Manifest(m) ||
    !parseTimeExportSnapshot({
      manifest: legacyManifest(m),
      records: records.map(legacyRecord),
    })
  )
    return null;
  if (
    records.reduce((s, r) => s + BigInt(r.unpaid_break_duration_microseconds), 0n) !==
    BigInt(m.total_unpaid_break_duration_microseconds)
  )
    return null;
  return { manifest: m, records };
}
export const blockers = [
  "open_entry",
  "pending_correction",
  "pending_break_correction",
  "no_records",
  "row_limit",
  "artifact_too_large",
] as const;
export const previewSchema = z
  .object({
    request_id: uuid,
    period_start_local: z.string(),
    period_end_local: z.string(),
    record_count: z.number().int().nonnegative(),
    employee_count: z.number().int().nonnegative(),
    blockers: z.array(z.enum(blockers)),
    warnings: z.array(z.enum(["missing_employee_code", "missing_display_name"])),
    records: z.array(recordSchema).max(10000),
  })
  .strict();
export type V2Preview = z.infer<typeof previewSchema>;
export function parseV2Preview(
  value: unknown,
  requestId: string,
  start: string,
  end: string,
) {
  const p = previewSchema.safeParse(value);
  if (
    !p.success ||
    p.data.request_id !== requestId ||
    p.data.period_start_local !== start ||
    p.data.period_end_local !== end
  )
    return null;
  const v = p.data;
  if (
    !isValidExportPeriod(start, end, end) ||
    (v.record_count === 0) !== v.blockers.includes("no_records") ||
    v.record_count > 10000 !== v.blockers.includes("row_limit") ||
    (v.record_count === 0 ? v.employee_count !== 0 : v.employee_count < 1)
  )
    return null;
  if (
    new Set(v.blockers).size !== v.blockers.length ||
    new Set(v.warnings).size !== v.warnings.length ||
    v.employee_count > v.record_count
  )
    return null;
  if (v.blockers.includes("row_limit") || v.blockers.includes("artifact_too_large"))
    return v.records.length === 0 ? v : null;
  if (v.record_count !== v.records.length) return null;
  if (v.records.length) {
    const m = {
      schema_version: "cloxa.time-export.v2",
      export_id: requestId,
      organization_id: requestId,
      worksite_id: v.records[0]!.worksite_id,
      timezone: "Europe/Brussels",
      selection_rule: "brussels-start-date.v1",
      period_start_local: start,
      period_end_local: end,
      created_at_utc: `${end}T23:59:59.000000Z`,
      record_count: v.record_count,
      employee_count: v.employee_count,
      dataset_sha256: "0".repeat(64),
      total_gross_duration_microseconds: v.records
        .reduce((s, r) => s + BigInt(r.gross_duration_microseconds), 0n)
        .toString(),
      total_unpaid_break_duration_microseconds: v.records
        .reduce((s, r) => s + BigInt(r.unpaid_break_duration_microseconds), 0n)
        .toString(),
      total_net_worked_duration_microseconds: v.records
        .reduce((s, r) => s + BigInt(r.net_worked_duration_microseconds), 0n)
        .toString(),
    };
    if (
      !parseV2Snapshot(
        { request_id: requestId, manifest: m, records: v.records },
        requestId,
      )
    )
      return null;
  }
  return v;
}
export function parseV2Creation(value: unknown, requestId: string) {
  const p = z
    .object({
      request_id: uuid,
      result_code: z.enum(["created", ...blockers]),
      did_create: z.boolean(),
      manifest: manifestSchema.nullable(),
    })
    .strict()
    .safeParse(value);
  if (!p.success || p.data.request_id !== requestId) return null;
  const r = p.data;
  return r.result_code === "created"
    ? r.did_create && r.manifest && parseV2Manifest(r.manifest)
      ? r
      : null
    : !r.did_create && r.manifest === null
      ? r
      : null;
}
export function parseV2History(value: unknown, requestId: string) {
  const p = z
    .object({ request_id: uuid, exports: z.array(manifestSchema).max(20) })
    .strict()
    .safeParse(value);
  return p.success &&
    p.data.request_id === requestId &&
    p.data.exports.every((m) => parseV2Manifest(m)) &&
    new Set(p.data.exports.map((m) => m.export_id)).size === p.data.exports.length
    ? p.data.exports
    : null;
}
export type V2ActionState = {
  message: string;
  requestId?: string;
  preview?: V2Preview;
  manifest?: V2Manifest;
};
