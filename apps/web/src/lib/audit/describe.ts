/**
 * Plain-Dutch descriptions for `audit_log.action` values, and the category
 * (action prefix) used to filter the viewer. Every action written by a
 * `private.write_audit`/`private.write_kiosk_audit` call in
 * `supabase/migrations` must have an entry here — `describe.test.ts` greps
 * the migrations and asserts it.
 */
import type { CatalogKey } from "@cloxa/i18n";

export const ACTION_DESCRIPTIONS: Readonly<Record<string, CatalogKey>> = {
  "clock_event.recorded": "audit.action.clockEventRecorded",
  "correction_request.created": "audit.action.correctionRequestCreated",
  "correction_request.withdrawn": "audit.action.correctionRequestWithdrawn",
  "correction_request.approved": "audit.action.correctionRequestApproved",
  "correction_request.rejected": "audit.action.correctionRequestRejected",
  "employee.kiosk_pin_set": "audit.action.employeeKioskPinSet",
  "employee.module_data_updated": "audit.action.employeeModuleDataUpdated",
  "employee.offboarded": "audit.action.employeeOffboarded",
  "employee.reinstated": "audit.action.employeeReinstated",
  "employee.self_data_exported": "audit.action.employeeSelfDataExported",
  "employee.subject_exported": "audit.action.employeeSubjectExported",
  "export.created": "audit.action.exportCreated",
  "export.downloaded": "audit.action.exportDownloaded",
  "export.integrity_failed": "audit.action.exportIntegrityFailed",
  "export.purged": "audit.action.exportPurged",
  "export.self_downloaded": "audit.action.exportSelfDownloaded",
  "integrity.chains_verified": "audit.action.integrityChainsVerified",
  "kiosk.created": "audit.action.kioskCreated",
  "kiosk.device_paused": "audit.action.kioskDevicePaused",
  "kiosk.paired": "audit.action.kioskPaired",
  "kiosk.pairing_code_created": "audit.action.kioskPairingCodeCreated",
  "kiosk.pin_failed": "audit.action.kioskPinFailed",
  "kiosk.pin_refused": "audit.action.kioskPinRefused",
  "kiosk.revoked": "audit.action.kioskRevoked",
  "member.accepted": "audit.action.memberAccepted",
  "member.invitation_revoked": "audit.action.memberInvitationRevoked",
  "member.invited": "audit.action.memberInvited",
  "member.linked": "audit.action.memberLinked",
  "member.signed_out_everywhere": "audit.action.memberSignedOutEverywhere",
  "organization.created": "audit.action.organizationCreated",
  "organization.retention_applied": "audit.action.organizationRetentionApplied",
  "organization.retention_failed": "audit.action.organizationRetentionFailed",
  "organization.module_updated": "audit.action.organizationModuleUpdated",
  "organization.settings_updated": "audit.action.organizationSettingsUpdated",
  "schedule.set": "audit.action.scheduleSet",
};

/** Falls back to a plain "unknown action" label rather than raw text. */
export function describeAction(action: string): CatalogKey {
  return ACTION_DESCRIPTIONS[action] ?? "audit.action.unknown";
}

function metadataField(metadata: unknown, field: string): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const value = (metadata as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

const MANAGER_ORIGIN_ACTIONS: Readonly<Record<string, CatalogKey>> = {
  "correction_request.created": "audit.action.correctionRequestCreatedByManager",
  "correction_request.approved": "audit.action.correctionRequestApprovedByManager",
};

/**
 * Like `describeAction`, but a correction a manager made (ADR 010,
 * `metadata.origin = 'manager'`) gets a sentence naming actor and employee.
 * Never the reason: it is not in the log.
 */
export function describeAuditEntry(action: string, metadata: unknown): CatalogKey {
  if (metadataField(metadata, "origin") === "manager") {
    const key = MANAGER_ORIGIN_ACTIONS[action];
    if (key) return key;
  }
  return describeAction(action);
}

/** The employee a manager-made correction is about, to look up their name. */
export function auditEmployeeId(action: string, metadata: unknown): string | null {
  return metadataField(metadata, "origin") === "manager" &&
    MANAGER_ORIGIN_ACTIONS[action] !== undefined
    ? metadataField(metadata, "employee_id")
    : null;
}

export const AUDIT_ENTITIES = [
  "clock_event",
  "correction_request",
  "employee",
  "export",
  "invitation",
  "kiosk_device",
  "membership",
  "organization",
  "schedule",
] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

export function entityLabelKey(entity: string): CatalogKey | null {
  return (AUDIT_ENTITIES as readonly string[]).includes(entity)
    ? (`audit.entity.${entity}` as CatalogKey)
    : null;
}

export const AUDIT_CATEGORIES = [
  "clock_event",
  "correction_request",
  "employee",
  "export",
  "integrity",
  "kiosk",
  "member",
  "organization",
  "schedule",
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

/** The part of the action before the first dot, e.g. `kiosk.paired` -> `kiosk`. */
export function actionCategory(action: string): string {
  return action.split(".")[0] ?? action;
}

export function categoryLabelKey(category: string): CatalogKey | null {
  return (AUDIT_CATEGORIES as readonly string[]).includes(category)
    ? (`audit.category.${category}` as CatalogKey)
    : null;
}
