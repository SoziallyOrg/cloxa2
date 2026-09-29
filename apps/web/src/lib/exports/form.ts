/**
 * Pure validation for "Nieuwe export": the period and site choice, and how
 * a choice maps onto the scope the database stores. The RPC re-checks all of
 * it; this gives early, friendly errors.
 */
import { MAX_EXPORT_PERIOD_DAYS, RpcError } from "@cloxa/db";
import { z } from "zod";

import { periodLength } from "./brussels";

export const exportFormSchema = z
  .strictObject({
    from: z.iso.date(),
    to: z.iso.date(),
    siteIds: z.array(z.uuid()).min(1).max(500),
    /** Only this interim agency's workers (ADR 008). */
    interimAgency: z.string().trim().min(1).max(200).optional(),
  })
  .refine(
    (value) => value.to >= value.from && periodLength(value) <= MAX_EXPORT_PERIOD_DAYS,
    { message: "invalid_period", path: ["to"] },
  );
export type ExportFormInput = z.input<typeof exportFormSchema>;

export type ExportScope = { ok: true; siteIds: string[] | null } | { ok: false };

/**
 * Owners and admins who pick every site export the whole organization
 * (`null`, which also covers sites added later in the period). Everyone else
 * gets the sorted, distinct list they picked, all of it within reach.
 */
export function resolveExportScope(
  role: string,
  visibleSiteIds: readonly string[],
  selected: readonly string[],
): ExportScope {
  const visible = new Set(visibleSiteIds);
  const picked = [...new Set(selected)].sort();
  if (picked.length === 0 || picked.some((id) => !visible.has(id))) {
    return { ok: false };
  }
  const orgWide = role === "owner" || role === "admin";
  if (orgWide && picked.length === visible.size) return { ok: true, siteIds: null };
  return { ok: true, siteIds: picked };
}

export type ExportErrorKey =
  | "exports.errorAgency"
  | "exports.errorPeriod"
  | "exports.errorSites"
  | "exports.errorTooLarge"
  | "exports.errorRateLimited"
  | "exports.errorGeneric";

/** Map a create-export failure to a copy key. */
export function mapExportError(error: unknown): ExportErrorKey {
  if (error instanceof RpcError) {
    switch (error.message) {
      case "invalid_period":
        return "exports.errorPeriod";
      case "site_not_visible":
      case "invalid_sites":
        return "exports.errorSites";
      case "export_rate_limited":
        return "exports.errorRateLimited";
      case "content_too_large":
        return "exports.errorTooLarge";
      default:
        return "exports.errorGeneric";
    }
  }
  if (error instanceof Error && error.message === "too_many_events") {
    return "exports.errorTooLarge";
  }
  return "exports.errorGeneric";
}
