import { expect, it } from "vitest";
import { v2 } from "./fixtures.test-data";
import {
  parseV2Snapshot,
  parseV2Creation,
  parseV2Preview,
  parseV2History,
} from "./model";
import { canonicalJsonb, createV2Artifact, v2DatasetHash } from "./serializer";
const id = v2.manifest.export_id;
it("parses and reconciles exact microseconds across DST", () =>
  expect(parseV2Snapshot({ ...v2, request_id: id }, id)).toEqual(v2));
it.each([
  "gross_duration_microseconds",
  "unpaid_break_duration_microseconds",
  "net_worked_duration_microseconds",
  "effective_break_count",
  "breaks",
])("fails altered field %s", (key) => {
  const data = structuredClone(v2);
  (data.records[0] as unknown as Record<string, unknown>)[key] =
    key === "breaks" ? [] : key === "effective_break_count" ? 2 : "1";
  expect(parseV2Snapshot({ ...data, request_id: id }, id)).toBeNull();
});
it.each([
  null,
  {},
  [],
  { ...v2, request_id: id, extra: 1 },
  { ...v2, request_id: "bad" },
  {
    ...v2,
    request_id: id,
    manifest: { ...v2.manifest, total_net_worked_duration_microseconds: "1" },
  },
])("fails malformed snapshot %#", (value) =>
  expect(parseV2Snapshot(value, id)).toBeNull(),
);
it.each(Object.keys(v2.records[0]!))("requires record key %s", (key) => {
  const data = structuredClone(v2);
  delete (data.records[0] as unknown as Record<string, unknown>)[key];
  expect(parseV2Snapshot({ ...data, request_id: id }, id)).toBeNull();
});
it.each(Object.keys(v2.manifest))("requires manifest key %s", (key) => {
  const data = structuredClone(v2);
  delete (data.manifest as unknown as Record<string, unknown>)[key];
  expect(parseV2Snapshot({ ...data, request_id: id }, id)).toBeNull();
});
it("creation strict compatibility and correlation", () => {
  const parse = (value: unknown) =>
    parseV2Creation(
      value,
      id,
      v2.manifest.period_start_local,
      v2.manifest.period_end_local,
    );
  const result = {
    request_id: id,
    result_code: "created",
    did_create: true,
    manifest: v2.manifest,
  };
  expect(parse(result)).not.toBeNull();
  expect(parse({ ...result, did_create: false })).toBeNull();
  expect(parse({ ...result, result_code: "pending_break_correction" })).toBeNull();
  expect(
    parse({
      ...result,
      manifest: { ...v2.manifest, period_start_local: "2010-10-30" },
    }),
  ).toBeNull();
  expect(
    parse({
      ...result,
      manifest: { ...v2.manifest, period_end_local: "2010-11-01" },
    }),
  ).toBeNull();
  expect(
    parse({
      ...result,
      result_code: "pending_break_correction",
      did_create: false,
      manifest: null,
    }),
  ).not.toBeNull();
});
it("history denies duplicate exports", () => {
  expect(parseV2History({ request_id: id, exports: [v2.manifest] }, id)).toHaveLength(
    1,
  );
  expect(
    parseV2History({ request_id: id, exports: [v2.manifest, v2.manifest] }, id),
  ).toBeNull();
});
it("preview validates records and selection", () => {
  const p = {
    request_id: id,
    period_start_local: v2.manifest.period_start_local,
    period_end_local: v2.manifest.period_end_local,
    record_count: 1,
    employee_count: 1,
    blockers: [],
    warnings: [],
    records: v2.records,
  };
  expect(
    parseV2Preview(p, id, p.period_start_local, p.period_end_local),
  ).not.toBeNull();
  expect(
    parseV2Preview(
      { ...p, record_count: 2 },
      id,
      p.period_start_local,
      p.period_end_local,
    ),
  ).toBeNull();
});
it("canonical ordering independent of object insertion order", () => {
  expect(canonicalJsonb({ bbb: 3, a: 1, cc: 2 })).toBe('{"a": 1, "cc": 2, "bbb": 3}');
  expect(v2DatasetHash(v2)).toBe(v2.manifest.dataset_sha256);
});
it.each(["csv", "json"] as const)("deterministic %s bytes", (format) => {
  const a = createV2Artifact(v2, format)!;
  expect(createV2Artifact(structuredClone(v2), format)).toEqual(a);
  expect(a.bytes.byteLength).toBeGreaterThan(100);
  expect(a.sha256).toMatch(/^[0-9a-f]{64}$/u);
});
it("CSV neutralizes names, quotes and reconciles canonical breaks", () => {
  const s = structuredClone(v2);
  s.records[0]!.employee_display_name = '=SUM(1,2)"\r\n';
  const csv = new TextDecoder().decode(createV2Artifact(s, "csv")!.bytes);
  expect(csv).toContain('"\'=SUM(1,2)""\r\n"');
  expect(csv).toContain('""logical_break_id""');
  expect(csv.endsWith("\r\n")).toBe(true);
  const json = new TextDecoder().decode(createV2Artifact(s, "json")!.bytes);
  expect(JSON.parse(json).records[0].employee_display_name).toBe(
    s.records[0]!.employee_display_name,
  );
});
it("bounds artifact bytes", () => {
  const s = structuredClone(v2);
  s.records[0]!.employee_display_name = "x".repeat(11 * 1024 * 1024);
  expect(createV2Artifact(s, "json")).toBeNull();
});
