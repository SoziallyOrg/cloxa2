/**
 * Pure parsing of the audit viewer's query string into typed filters.
 * Lenient by field: an invalid value for one filter is dropped rather than
 * failing the whole page (this is a filter bar, not a form to validate).
 */
import { z } from "zod";

import { AUDIT_CATEGORIES, type AuditCategory } from "./describe";

export interface AuditFilters {
  readonly from: string | null;
  readonly to: string | null;
  readonly category: AuditCategory | null;
  readonly actor: string | null;
  readonly cursor: string | null;
}

const dateSchema = z.iso.date();
const actorSchema = z.string().trim().min(1).max(100);
const cursorSchema = z.string().trim().min(1).max(500);

function first(value: string | readonly string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0] as string | undefined;
  return value as string | undefined;
}

function parseDate(value: string | undefined): string | null {
  if (value === undefined) return null;
  const parsed = dateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseCategory(value: string | undefined): AuditCategory | null {
  if (value === undefined) return null;
  return (AUDIT_CATEGORIES as readonly string[]).includes(value)
    ? (value as AuditCategory)
    : null;
}

function parseActor(value: string | undefined): string | null {
  if (value === undefined) return null;
  const parsed = actorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseCursor(value: string | undefined): string | null {
  if (value === undefined) return null;
  const parsed = cursorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Reads Next.js's `searchParams` shape. Swaps `from`/`to` when reversed
 * instead of rejecting them: exploring a log has no wrong order.
 */
export function parseAuditFilters(
  params: Record<string, string | readonly string[] | undefined>,
): AuditFilters {
  let from = parseDate(first(params.from));
  let to = parseDate(first(params.to));
  if (from !== null && to !== null && from > to) {
    [from, to] = [to, from];
  }
  return {
    from,
    to,
    category: parseCategory(first(params.category)),
    actor: parseActor(first(params.actor)),
    cursor: parseCursor(first(params.cursor)),
  };
}
