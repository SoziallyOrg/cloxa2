/**
 * Canonical JSON for signed exports: the RFC 8785 (JCS) rules for the subset
 * we emit. Object keys sorted by UTF-16 code units, no whitespace, strings as
 * `JSON.stringify` writes them, and numbers limited to safe integers so no
 * float formatting question ever arises. Anyone can re-derive the exact bytes
 * with a JCS library and check the signature.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isSafeInteger(value)) {
        throw new TypeError(`canonicalJson: only safe integers, got ${value}`);
      }
      // -0 and 0 must not differ.
      return String(value === 0 ? 0 : value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
      }
      const prototype = Object.getPrototypeOf(value) as unknown;
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError("canonicalJson: only plain objects");
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      return `{${keys
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
        .join(",")}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported ${typeof value}`);
  }
}
