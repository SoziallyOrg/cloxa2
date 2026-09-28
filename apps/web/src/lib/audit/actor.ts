/**
 * Who did it, for one `audit_log` row. Pure: callers resolve
 * `actor_user_id` -> employee display name and `metadata.device_id` ->
 * kiosk device name (both scoped by RLS) and pass the results in. Never
 * shows a raw metadata value: person and device names come from their own
 * tables, not from `metadata`.
 */
export interface AuditActorInput {
  readonly actorUserId: string | null;
  readonly displayName: string | null;
  readonly deviceId: string | null;
  readonly deviceName: string | null;
}

export type AuditActorLabel =
  | { readonly kind: "person"; readonly name: string | null }
  | { readonly kind: "kiosk"; readonly deviceName: string | null }
  | { readonly kind: "system" };

export function auditActorLabel(input: AuditActorInput): AuditActorLabel {
  if (input.actorUserId !== null) {
    return { kind: "person", name: input.displayName };
  }
  if (input.deviceId !== null) {
    return { kind: "kiosk", deviceName: input.deviceName };
  }
  return { kind: "system" };
}
