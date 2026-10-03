import { describe, expect, it } from "vitest";

import { canonicalJson } from "./canonical";
import { downloadHeaders, exportFilename, jsonEnvelope } from "./download";

describe("jsonEnvelope", () => {
  const content = canonicalJson({ rows: [{ day: "2026-09-01" }], format_version: "x" });
  const envelope = jsonEnvelope(content, {
    sha256Hex: "ab".repeat(32),
    signatureHex: "01".repeat(64),
    keyId: "prod-1",
  });

  it("carries the stored bytes untouched, so re-canonicalising gives them back", () => {
    const parsed = JSON.parse(envelope) as { content: unknown };
    expect(canonicalJson(parsed.content)).toBe(content);
    expect(envelope.startsWith(`{"content":${content},`)).toBe(true);
  });

  it("adds a detached Ed25519 signature block", () => {
    const parsed = JSON.parse(envelope) as { signature: Record<string, string> };
    expect(parsed.signature).toEqual({
      algorithm: "Ed25519",
      keyId: "prod-1",
      sha256: "ab".repeat(32),
      signature: Buffer.from("01".repeat(64), "hex").toString("base64"),
    });
  });
});

describe("download headers", () => {
  it("names the file after the period and hash, and never caches", () => {
    const filename = exportFilename(
      { from: "2026-09-01", to: "2026-09-30" },
      "0123456789abcdef".repeat(4),
      "csv",
    );
    expect(filename).toBe("cloxa-export_2026-09-01_2026-09-30_0123456789ab.csv");
    expect(downloadHeaders(filename, "csv")).toMatchObject({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    });
  });
});
