/**
 * Keyset pagination on `(created_at, id)`, newest first. A page is fetched
 * with `limit + 1` rows; when the extra row exists there's a next page, and
 * its cursor is the last *kept* row (never the extra one).
 */

export interface AuditCursor {
  readonly createdAt: string;
  readonly id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeAuditCursor(cursor: AuditCursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, "utf8").toString("base64url");
}

/** `null` for anything malformed: a bad cursor just restarts at page one. */
export function decodeAuditCursor(
  value: string | null | undefined,
): AuditCursor | null {
  if (!value) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const separator = decoded.indexOf("|");
  if (separator < 0) return null;
  const createdAt = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  if (Number.isNaN(Date.parse(createdAt)) || !UUID_RE.test(id)) return null;
  return { createdAt, id };
}

/**
 * The PostgREST `.or()` filter for "strictly before this cursor" in a
 * `created_at desc, id desc` ordering.
 */
export function auditKeysetFilter(cursor: AuditCursor): string {
  return (
    `created_at.lt.${cursor.createdAt},` +
    `and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
  );
}

export interface AuditKeysetRow {
  readonly createdAt: string;
  readonly id: string;
}

export interface AuditKeysetPage<T extends AuditKeysetRow> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

/** `rows` is the `limit + 1` fetch, ordered newest first. */
export function paginateAuditKeyset<T extends AuditKeysetRow>(
  rows: readonly T[],
  limit: number,
): AuditKeysetPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      hasMore && last
        ? encodeAuditCursor({ createdAt: last.createdAt, id: last.id })
        : null,
  };
}
