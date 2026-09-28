/**
 * The decisions the export route handlers make, as pure functions so each
 * branch is unit-tested: who may download, whether stored bytes may be
 * served, and which month a self export covers.
 */
import { brusselsDayKey } from "@cloxa/domain";

import { monthPeriod, type ExportPeriod } from "./brussels";
import type { SignatureCheck } from "./signing";

export interface DownloadAccessInput {
  /** A member of the selected organization (false when anonymous or without one). */
  readonly member: boolean;
  readonly privileged: boolean;
  /** Fresh MFA and recent activity (the /manage gate). */
  readonly gateOk: boolean;
}

/** 403 unless a privileged member with a passing /manage gate. */
export function downloadAccess(input: DownloadAccessInput): 200 | 403 {
  return input.member && input.privileged && input.gateOk ? 200 : 403;
}

export type IntegrityVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly status: 409; readonly reason: "hash" | "signature" };

/**
 * Serve only bytes that still match their stored sha256 and carry a
 * signature we can vouch for (`unverifiable` is the dev-only per-process key).
 */
export function integrityVerdict(input: {
  storedSha256Hex: string;
  actualSha256Hex: string;
  signature: SignatureCheck;
}): IntegrityVerdict {
  if (input.actualSha256Hex !== input.storedSha256Hex) {
    return { ok: false, status: 409, reason: "hash" };
  }
  if (input.signature === "invalid") {
    return { ok: false, status: 409, reason: "signature" };
  }
  return { ok: true };
}

const MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;

export type SelfExportRequest =
  | { readonly ok: true; readonly month: string; readonly period: ExportPeriod }
  | { readonly ok: false; readonly status: 400 };

/** `?maand=YYYY-MM`, not in the future (Brussels calendar), cut off at today. */
export function selfExportRequest(
  maand: string | null,
  nowMs: number,
): SelfExportRequest {
  const today = brusselsDayKey(nowMs);
  if (maand === null || !MONTH.test(maand) || `${maand}-01` > today) {
    return { ok: false, status: 400 };
  }
  return { ok: true, month: maand, period: monthPeriod(maand, today) };
}
