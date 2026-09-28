/**
 * The result of `rpc_verify_chains`, mapped to a plain shape the UI renders
 * without ever claiming "onveranderbaar" or a legal guarantee (see
 * `CLAUDE.md`): it only states what was checked and when.
 */
import { RpcError } from "@cloxa/db";
import type { CatalogKey } from "@cloxa/i18n";

export type VerifyChainsResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly clockBrokenEventId: string | null;
      readonly auditBrokenRowId: string | null;
    };

export function toVerifyChainsResult(row: {
  clock_broken_event_id: string | null;
  audit_broken_row_id: string | null;
}): VerifyChainsResult {
  if (row.clock_broken_event_id === null && row.audit_broken_row_id === null) {
    return { ok: true };
  }
  return {
    ok: false,
    clockBrokenEventId: row.clock_broken_event_id,
    auditBrokenRowId: row.audit_broken_row_id,
  };
}

export function mapVerifyChainsError(error: unknown): CatalogKey {
  if (error instanceof RpcError && error.code === "42501") {
    return "audit.verifyOwnerOnly";
  }
  return "audit.verifyError";
}
