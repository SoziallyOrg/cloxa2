/**
 * "Uit dienst": the plain-Dutch consequences shown in the confirm step, the
 * retention the org actually applies, and friendly error keys. Pure, so the
 * copy people agree to is unit-tested.
 */
import { RpcError } from "@cloxa/db";
import type { CatalogKey } from "@cloxa/i18n";

/** The legal floor the database also enforces (ADR 007). */
export const MIN_RETENTION_YEARS = 5;

export interface CopyLine {
  readonly key: CatalogKey;
  readonly values?: Readonly<Record<string, string | number>>;
}

export interface OffboardCopyInput {
  readonly name: string;
  /** False for kiosk-only workers: there is no login to end. */
  readonly hasLogin: boolean;
  readonly retentionYears: number;
}

/** Retention from `organizations.settings`: never below 5 years, 5 when unset. */
export function effectiveRetentionYears(settings: unknown): number {
  const raw =
    settings !== null && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)["retention_years"]
      : undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return MIN_RETENTION_YEARS;
  return Math.max(MIN_RETENTION_YEARS, Math.floor(raw));
}

export function offboardConfirmLines(input: OffboardCopyInput): CopyLine[] {
  const name = { name: input.name };
  return [
    ...(input.hasLogin
      ? [{ key: "manageEmployee.offboardConsequenceLogin" as const, values: name }]
      : []),
    { key: "manageEmployee.offboardConsequenceClock", values: name },
    { key: "manageEmployee.offboardConsequenceRecords" },
    {
      key: "manageEmployee.offboardConsequenceRetention",
      values: { years: Math.max(MIN_RETENTION_YEARS, input.retentionYears) },
    },
    { key: "manageEmployee.offboardConsequenceUndo" },
  ];
}

export type OffboardErrorKey =
  | "manageEmployee.errorNotAllowed"
  | "manageEmployee.errorOwner"
  | "manageEmployee.errorSelf"
  | "manageEmployee.errorAlreadyLeft"
  | "manageEmployee.errorNotLeft"
  | "manageEmployee.errorAnonymised"
  | "manageEmployee.errorGeneric";

export function mapOffboardError(error: unknown): OffboardErrorKey {
  if (!(error instanceof RpcError)) return "manageEmployee.errorGeneric";
  switch (error.message) {
    case "not_authorized":
      return "manageEmployee.errorNotAllowed";
    case "cannot_offboard_owner":
      return "manageEmployee.errorOwner";
    case "cannot_offboard_self":
      return "manageEmployee.errorSelf";
    case "already_left":
      return "manageEmployee.errorAlreadyLeft";
    case "not_left":
      return "manageEmployee.errorNotLeft";
    case "employee_anonymised":
      return "manageEmployee.errorAnonymised";
    default:
      return "manageEmployee.errorGeneric";
  }
}
