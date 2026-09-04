import { createHash } from "node:crypto";
import { neutralizeSpreadsheetCell } from "@/lib/time-exports/serializer";
import { MAX_EXPORT_BYTES } from "@/lib/time-exports/model";
import type { V2Snapshot } from "./model";
export function canonicalJsonb(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJsonb).join(", ")}]`;
  if (value !== null && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row)
      .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
      .map((k) => `${JSON.stringify(k)}: ${canonicalJsonb(row[k])}`)
      .join(", ")}}`;
  }
  return JSON.stringify(value);
}
export function v2DatasetHash(snapshot: V2Snapshot) {
  const { dataset_sha256: _hash, ...manifest } = snapshot.manifest;
  void _hash;
  return createHash("sha256")
    .update(canonicalJsonb({ manifest, records: snapshot.records }), "utf8")
    .digest("hex");
}
export function createV2Artifact(snapshot: V2Snapshot, format: "csv" | "json") {
  let text: string;
  if (format === "json") text = `${canonicalJsonb(snapshot)}\n`;
  else {
    const csv = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const manifests = Object.keys(snapshot.manifest).sort();
    const records = Object.keys(snapshot.records[0]!)
      .filter((k) => k !== "worksite_id")
      .sort();
    const rows = snapshot.records.map((r) => {
      const wire = { ...snapshot.manifest, ...r } as Record<string, unknown>;
      return [...manifests, ...records]
        .map((k) =>
          csv(
            k === "breaks"
              ? canonicalJsonb(wire[k])
              : ["employee_code", "employee_display_name", "worksite_name"].includes(
                    k,
                  ) && typeof wire[k] === "string"
                ? neutralizeSpreadsheetCell(wire[k])
                : wire[k],
          ),
        )
        .join(",");
    });
    text = `\uFEFF${[[...manifests, ...records].map(csv).join(","), ...rows].join("\r\n")}\r\n`;
  }
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > MAX_EXPORT_BYTES) return null;
  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    contentType:
      format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
    filename: `cloxa-time-export-v2_${snapshot.manifest.period_start_local}_${snapshot.manifest.period_end_local}_${snapshot.manifest.export_id}.${format}`,
  };
}
