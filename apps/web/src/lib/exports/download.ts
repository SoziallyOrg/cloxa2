/**
 * Response bodies and headers for export downloads. Pure, so the exact bytes
 * people receive are unit-tested.
 */
import { SIGNATURE_ALGORITHM } from "./signing";

export type ExportFormat = "csv" | "json";

export interface DetachedSignature {
  readonly sha256Hex: string;
  readonly signatureHex: string;
  readonly keyId: string;
}

/**
 * `{"content":<stored bytes>,"signature":{...}}`. The stored canonical text
 * is spliced in untouched, so `content` re-canonicalised with any RFC 8785
 * library gives back exactly the signed bytes.
 */
export function jsonEnvelope(
  contentText: string,
  signature: DetachedSignature,
): string {
  const block = {
    algorithm: SIGNATURE_ALGORITHM,
    keyId: signature.keyId,
    sha256: signature.sha256Hex,
    signature: Buffer.from(signature.signatureHex, "hex").toString("base64"),
  };
  return `{"content":${contentText},"signature":${JSON.stringify(block)}}`;
}

export function exportFilename(
  period: { from: string; to: string },
  sha256Hex: string,
  format: ExportFormat,
): string {
  return `cloxa-export_${period.from}_${period.to}_${sha256Hex.slice(0, 12)}.${format}`;
}

export function downloadHeaders(filename: string, format: ExportFormat): HeadersInit {
  return {
    "Content-Type":
      format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
    // Filenames are ASCII by construction (dates, hex, fixed words).
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}
