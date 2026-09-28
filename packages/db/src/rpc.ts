/**
 * Typed wrappers for every public RPC, with zod input schemas.
 *
 * Each wrapper parses its input (throws a ZodError on bad input), calls the
 * RPC on the given client and throws an RpcError when the database refuses.
 * The database stays authoritative: these schemas give early, typed feedback
 * and mirror the SQL checks, they never replace them.
 *
 * The client is passed in, so this package has no runtime Supabase import:
 * user-session clients for user RPCs, the secret-key client only for the
 * service_role RPCs (marked below), and only on the server.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database, Json } from "./database.types";

export type CloxaClient = SupabaseClient<Database>;

type Functions = Database["public"]["Functions"];
type Returns<F extends keyof Functions> = Functions[F]["Returns"];
type Row<F extends keyof Functions> =
  Returns<F> extends readonly (infer R)[] ? R : never;

/** A refused RPC. `message` is the database's machine code, e.g. `invalid_transition`. */
export class RpcError extends Error {
  readonly rpc: string;
  /** SQLSTATE, e.g. `42501` (not authorized), `22023` (invalid input), `P0001` (rule). */
  readonly code: string;
  readonly details: string | null;

  constructor(
    rpc: string,
    error: { message: string; code: string; details?: string | null },
  ) {
    super(error.message);
    this.name = "RpcError";
    this.rpc = rpc;
    this.code = error.code;
    this.details = error.details ?? null;
  }
}

interface RpcResponse<T> {
  data: T | null;
  error: { message: string; code: string; details?: string | null } | null;
}

function unwrap<T>(rpc: string, response: RpcResponse<T>): T {
  if (response.error) throw new RpcError(rpc, response.error);
  if (response.data === null) {
    throw new RpcError(rpc, { message: "empty_response", code: "PGRST" });
  }
  return response.data;
}

function first<T>(rpc: string, rows: readonly T[]): T {
  const [row] = rows;
  if (row === undefined)
    throw new RpcError(rpc, { message: "empty_response", code: "PGRST" });
  return row;
}

/** Adds `key: value` only when value is defined (exactOptionalPropertyTypes). */
function optional<K extends string, V>(
  key: K,
  value: V | undefined,
): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

// Shared fields ---------------------------------------------------------------------------

const uuid = z.uuid();
/** ISO 8601 with Z or an explicit offset; the database rejects local times. */
const instant = z.iso.datetime({ offset: true });
const localDate = z.iso.date();
const liveClockType = z.enum(["clock_in", "clock_out", "break_start", "break_end"]);
const shortText = (max: number) => z.string().trim().min(1).max(max);
const uniqueIds = (ids: readonly string[]) => new Set(ids).size === ids.length;

// Live clocking ----------------------------------------------------------------------------

export const clockInput = z.strictObject({
  type: liveClockType,
  idempotencyKey: uuid,
  siteId: uuid,
  clientCapturedAt: instant.optional(),
});
export type ClockInput = z.input<typeof clockInput>;

export async function clock(
  client: CloxaClient,
  input: ClockInput,
): Promise<Returns<"rpc_clock">> {
  const parsed = clockInput.parse(input);
  return unwrap(
    "rpc_clock",
    await client.rpc("rpc_clock", {
      p_type: parsed.type,
      p_idempotency_key: parsed.idempotencyKey,
      p_site_id: parsed.siteId,
      ...optional("p_client_captured_at", parsed.clientCapturedAt),
    }),
  );
}

export async function myStatus(client: CloxaClient): Promise<Returns<"rpc_my_status">> {
  return unwrap("rpc_my_status", await client.rpc("rpc_my_status"));
}

export const verifyChainsInput = z.strictObject({ organizationId: uuid });
export type VerifyChainsInput = z.input<typeof verifyChainsInput>;

/** Owner only, fresh MFA. Null ids mean the chain verified. */
export async function verifyChains(
  client: CloxaClient,
  input: VerifyChainsInput,
): Promise<Row<"rpc_verify_chains">> {
  const parsed = verifyChainsInput.parse(input);
  const rows = unwrap(
    "rpc_verify_chains",
    await client.rpc("rpc_verify_chains", { p_org: parsed.organizationId }),
  );
  return first("rpc_verify_chains", rows);
}

// Schedules --------------------------------------------------------------------------------

const MINUTES = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutes(value: string): number {
  if (value === "24:00") return 1440;
  const match = MINUTES.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN;
}

const scheduleBlock = z.strictObject({
  start: z.string().regex(MINUTES),
  end: z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/),
});

/** Sorted, non-overlapping, non-empty blocks; only the last may cross midnight (end < start). */
const scheduleBlocks = z
  .array(scheduleBlock)
  .max(6)
  .refine(
    (blocks) => {
      let previousEnd = -1;
      let crossed = false;
      for (const block of blocks) {
        const start = minutes(block.start);
        const end = minutes(block.end);
        if (crossed || start === end || start < previousEnd) return false;
        crossed = end < start;
        previousEnd = end;
      }
      return true;
    },
    {
      message:
        "blocks must be sorted, non-overlapping and only the last may cross midnight",
    },
  );

export const schedulePatternSchema = z
  .strictObject({
    mon: scheduleBlocks.optional(),
    tue: scheduleBlocks.optional(),
    wed: scheduleBlocks.optional(),
    thu: scheduleBlocks.optional(),
    fri: scheduleBlocks.optional(),
    sat: scheduleBlocks.optional(),
    sun: scheduleBlocks.optional(),
    exceptions: z
      .array(z.strictObject({ date: localDate, blocks: scheduleBlocks }))
      .max(100)
      .refine((items) => uniqueIds(items.map((item) => item.date)), {
        message: "exception dates must be unique",
      })
      .optional(),
  })
  // The database measures its own (slightly longer) jsonb text; it has the last word.
  .refine(
    (pattern) => new TextEncoder().encode(JSON.stringify(pattern)).length <= 16_384,
    {
      message: "pattern is too large",
    },
  );
export type SchedulePattern = z.output<typeof schedulePatternSchema>;

export const setScheduleInput = z.strictObject({
  employeeId: uuid,
  validFrom: localDate,
  pattern: schedulePatternSchema,
});
export type SetScheduleInput = z.input<typeof setScheduleInput>;

/** Privileged, fresh MFA. Appends a new version; nothing is overwritten. */
export async function setSchedule(
  client: CloxaClient,
  input: SetScheduleInput,
): Promise<Returns<"rpc_set_schedule">> {
  const parsed = setScheduleInput.parse(input);
  return unwrap(
    "rpc_set_schedule",
    await client.rpc("rpc_set_schedule", {
      p_employee_id: parsed.employeeId,
      p_valid_from: parsed.validFrom,
      p_pattern: parsed.pattern as Json,
    }),
  );
}

const DAY_MS = 86_400_000;

export const scheduleForInput = z
  .strictObject({ employeeId: uuid, from: localDate, to: localDate })
  .refine(
    ({ from, to }) => {
      const days =
        (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
      return days >= 0 && days <= 92;
    },
    { message: "range must be 1 to 93 days", path: ["to"] },
  );
export type ScheduleForInput = z.input<typeof scheduleForInput>;

/** Planned blocks per local day as instants, expanded in the organization timezone. */
export async function scheduleFor(
  client: CloxaClient,
  input: ScheduleForInput,
): Promise<Returns<"rpc_schedule_for">> {
  const parsed = scheduleForInput.parse(input);
  return unwrap(
    "rpc_schedule_for",
    await client.rpc("rpc_schedule_for", {
      p_employee_id: parsed.employeeId,
      p_from: parsed.from,
      p_to: parsed.to,
    }),
  );
}

// Corrections ------------------------------------------------------------------------------

/** Free text for the decider only. UI warns: no medical details. */
const reason = shortText(280);

/** Proposed instants must strictly increase in proposal order (the database also rejects ties with existing events). */
const increasing = (events: readonly { occurredAt: string }[]) =>
  events.every(
    (event, index) =>
      index === 0 ||
      Date.parse(event.occurredAt) > Date.parse(events[index - 1]?.occurredAt ?? ""),
  );
const increasingMessage = { message: "proposed times must strictly increase" };

export const requestCorrectionInput = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("add"),
    events: z
      .array(z.strictObject({ type: liveClockType, occurredAt: instant, siteId: uuid }))
      .min(1)
      .max(8)
      .refine(increasing, increasingMessage),
    reason,
  }),
  z.strictObject({
    kind: z.literal("adjust"),
    events: z
      .array(z.strictObject({ targetEventId: uuid, occurredAt: instant }))
      .min(1)
      .max(10)
      .refine((events) => uniqueIds(events.map((event) => event.targetEventId)), {
        message: "each event can be adjusted once",
      })
      .refine(increasing, increasingMessage),
    reason,
  }),
  z.strictObject({
    kind: z.literal("remove"),
    targetEventIds: z.array(uuid).min(1).max(10).refine(uniqueIds, {
      message: "each event can be removed once",
    }),
    reason,
  }),
]);
export type RequestCorrectionInput = z.input<typeof requestCorrectionInput>;

/** Employee, for their own effective events only. */
export async function requestCorrection(
  client: CloxaClient,
  input: RequestCorrectionInput,
): Promise<Returns<"rpc_request_correction">> {
  const parsed = requestCorrectionInput.parse(input);

  let targets: string[];
  let proposed: Json;
  switch (parsed.kind) {
    case "add":
      targets = [];
      proposed = {
        events: parsed.events.map((event) => ({
          type: event.type,
          occurred_at: event.occurredAt,
          site_id: event.siteId,
        })),
      };
      break;
    case "adjust":
      targets = parsed.events.map((event) => event.targetEventId);
      proposed = {
        events: parsed.events.map((event) => ({
          target_event_id: event.targetEventId,
          occurred_at: event.occurredAt,
        })),
      };
      break;
    case "remove":
      targets = parsed.targetEventIds;
      proposed = {};
      break;
  }

  return unwrap(
    "rpc_request_correction",
    await client.rpc("rpc_request_correction", {
      p_kind: parsed.kind,
      p_target_event_ids: targets,
      p_proposed: proposed,
      p_reason: parsed.reason,
    }),
  );
}

export const withdrawCorrectionInput = z.strictObject({ id: uuid });
export type WithdrawCorrectionInput = z.input<typeof withdrawCorrectionInput>;

export async function withdrawCorrection(
  client: CloxaClient,
  input: WithdrawCorrectionInput,
): Promise<Returns<"rpc_withdraw_correction">> {
  const parsed = withdrawCorrectionInput.parse(input);
  return unwrap(
    "rpc_withdraw_correction",
    await client.rpc("rpc_withdraw_correction", { p_id: parsed.id }),
  );
}

export const decideCorrectionInput = z.strictObject({
  id: uuid,
  decision: z.enum(["approved", "rejected"]),
  note: shortText(280).optional(),
});
export type DecideCorrectionInput = z.input<typeof decideCorrectionInput>;

/** Privileged, fresh MFA, manager-scoped; a manager never decides their own request. */
export async function decideCorrection(
  client: CloxaClient,
  input: DecideCorrectionInput,
): Promise<Returns<"rpc_decide_correction">> {
  const parsed = decideCorrectionInput.parse(input);
  return unwrap(
    "rpc_decide_correction",
    await client.rpc("rpc_decide_correction", {
      p_id: parsed.id,
      p_decision: parsed.decision,
      ...optional("p_note", parsed.note),
    }),
  );
}

// Auth attempt limiting (service_role) -----------------------------------------------------

/**
 * Lowercase hex keyed hash (HMAC-SHA256 on the server) of the normalised email,
 * the client IP, a login flow or a user id. Never the raw value.
 */
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
const bytea = (hex: string) => `\\x${hex}`;

/** Null when no trusted proxy vouches for the client IP: IP-keyed rules are skipped. */
const ipHash = sha256Hex.nullable();

export const authAttemptInput = z.discriminatedUnion("kind", [
  /**
   * Sending a code: 3 per email + IP pair and 20 per IP per 15 minutes (only
   * when the IP is known), 10 per email per hour. `pairHash` is present
   * exactly when `ipHash` is.
   */
  z
    .strictObject({
      kind: z.literal("otp_request"),
      emailHash: sha256Hex,
      ipHash,
      pairHash: sha256Hex.nullable(),
    })
    .refine((value) => (value.ipHash === null) === (value.pairHash === null), {
      message: "pairHash must be set exactly when ipHash is",
    }),
  /** Checking an email code: 5 failures per flow (email + per-flow nonce), 30 per IP per 15 minutes. */
  z.strictObject({
    kind: z.literal("otp_verify"),
    emailHash: sha256Hex,
    flowHash: sha256Hex,
    ipHash,
  }),
  /**
   * Before posting an email link: a check only, nothing is recorded. Blocked
   * after 30 failures per IP per 15 minutes, or `paused` for everyone after
   * 300 failures per 10 minutes. Record failures with `authLinkFailure`.
   */
  z.strictObject({ kind: z.literal("link_verify"), ipHash }),
  /** Checking a TOTP code: 5 failures per user, then a 15-minute block. */
  z.strictObject({ kind: z.literal("totp_verify"), userHash: sha256Hex }),
]);
export type AuthAttemptInput = z.input<typeof authAttemptInput>;

export interface AuthAttemptResult {
  allowed: boolean;
  retryAfterSeconds: number;
  /** Link sign-in is paused for everyone (the global link-failure ceiling). */
  paused: boolean;
}

/**
 * service_role only (secret-key client). Call before each OTP request and
 * each code, link or TOTP verification; a blocked attempt is not recorded.
 */
export async function authAttempt(
  client: CloxaClient,
  input: AuthAttemptInput,
): Promise<AuthAttemptResult> {
  const parsed = authAttemptInput.parse(input);
  const hex = (value: string | null | undefined) =>
    value === undefined || value === null ? null : bytea(value);
  const args = {
    p_kind: parsed.kind,
    p_email_hash: hex("emailHash" in parsed ? parsed.emailHash : undefined),
    p_ip_hash: hex("ipHash" in parsed ? parsed.ipHash : undefined),
    p_subject_hash: hex(
      parsed.kind === "otp_request"
        ? parsed.pairHash
        : parsed.kind === "otp_verify"
          ? parsed.flowHash
          : parsed.kind === "totp_verify"
            ? parsed.userHash
            : undefined,
    ),
  };
  const rows = unwrap(
    "rpc_auth_attempt",
    // The generated types don't model SQL nulls for these arguments.
    await client.rpc("rpc_auth_attempt", args as Functions["rpc_auth_attempt"]["Args"]),
  );
  const row = first("rpc_auth_attempt", rows);
  return {
    allowed: row.allowed,
    retryAfterSeconds: row.retry_after,
    paused: row.paused,
  };
}

export const authLinkFailureInput = z.strictObject({ ipHash });
export type AuthLinkFailureInput = z.input<typeof authLinkFailureInput>;

/** service_role only. Call after an email link was refused; never after a success. */
export async function authLinkFailure(
  client: CloxaClient,
  input: AuthLinkFailureInput,
): Promise<void> {
  const parsed = authLinkFailureInput.parse(input);
  const { error } = await client.rpc("rpc_auth_link_failure", {
    p_ip_hash: parsed.ipHash === null ? null : bytea(parsed.ipHash),
  } as Functions["rpc_auth_link_failure"]["Args"]);
  if (error) throw new RpcError("rpc_auth_link_failure", error);
}

/** The email hash after a code or link, the user hash after TOTP. */
export const authAttemptResetInput = z.strictObject({ emailHash: sha256Hex });
export type AuthAttemptResetInput = z.input<typeof authAttemptResetInput>;

/** service_role only. Call after a successful verification. */
export async function authAttemptReset(
  client: CloxaClient,
  input: AuthAttemptResetInput,
): Promise<void> {
  const parsed = authAttemptResetInput.parse(input);
  const { error } = await client.rpc("rpc_auth_attempt_reset", {
    p_email_hash: bytea(parsed.emailHash),
  });
  if (error) throw new RpcError("rpc_auth_attempt_reset", error);
}

// Onboarding and members -------------------------------------------------------------------

export const adminCreateOrganizationInput = z.strictObject({
  name: shortText(200),
  ownerUserId: uuid,
  ownerDisplayName: shortText(200).optional(),
});
export type AdminCreateOrganizationInput = z.input<typeof adminCreateOrganizationInput>;

/** service_role only. */
export async function adminCreateOrganization(
  client: CloxaClient,
  input: AdminCreateOrganizationInput,
): Promise<Row<"rpc_admin_create_organization">> {
  const parsed = adminCreateOrganizationInput.parse(input);
  const rows = unwrap(
    "rpc_admin_create_organization",
    await client.rpc("rpc_admin_create_organization", {
      p_name: parsed.name,
      p_owner_user_id: parsed.ownerUserId,
      ...optional("p_owner_display_name", parsed.ownerDisplayName),
    }),
  );
  return first("rpc_admin_create_organization", rows);
}

export const inviteMemberInput = z.strictObject({
  organizationId: uuid,
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  // Managers may only invite employees; the database enforces it.
  role: z.enum(["admin", "manager", "employee"]),
  displayName: shortText(200),
  siteIds: z.array(uuid).max(50).refine(uniqueIds, { message: "sites must be unique" }),
  employeeCode: shortText(64).optional(),
  statute: z
    .enum(["bediende", "arbeider", "student", "flexi", "interim", "other"])
    .optional(),
  language: z
    .string()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
    .optional(),
});
export type InviteMemberInput = z.input<typeof inviteMemberInput>;

/** Privileged, fresh MFA (the inviter's own session). Returns the invitation id. */
export async function inviteMember(
  client: CloxaClient,
  input: InviteMemberInput,
): Promise<string> {
  const parsed = inviteMemberInput.parse(input);
  return unwrap(
    "rpc_invite_member",
    await client.rpc("rpc_invite_member", {
      p_org: parsed.organizationId,
      p_email: parsed.email,
      p_role: parsed.role,
      p_display_name: parsed.displayName,
      p_site_ids: parsed.siteIds,
      ...optional("p_employee_code", parsed.employeeCode),
      ...optional("p_statute", parsed.statute),
      ...optional("p_language", parsed.language),
    }),
  );
}

export const revokeInvitationInput = z.strictObject({ id: uuid });
export type RevokeInvitationInput = z.input<typeof revokeInvitationInput>;

/** Privileged, fresh MFA: owners and admins revoke any open invitation, a manager only their own. */
export async function revokeInvitation(
  client: CloxaClient,
  input: RevokeInvitationInput,
): Promise<void> {
  const parsed = revokeInvitationInput.parse(input);
  const { error } = await client.rpc("rpc_revoke_invitation", { p_id: parsed.id });
  if (error) throw new RpcError("rpc_revoke_invitation", error);
}

export const linkInvitedUserInput = z.strictObject({
  invitationId: uuid,
  userId: uuid,
});
export type LinkInvitedUserInput = z.input<typeof linkInvitedUserInput>;

/**
 * service_role only, after auth.admin.inviteUserByEmail. Returns the membership
 * id. Refused for revoked or expired (7 days) invitations.
 */
export async function linkInvitedUser(
  client: CloxaClient,
  input: LinkInvitedUserInput,
): Promise<string> {
  const parsed = linkInvitedUserInput.parse(input);
  return unwrap(
    "rpc_link_invited_user",
    await client.rpc("rpc_link_invited_user", {
      p_invitation_id: parsed.invitationId,
      p_user_id: parsed.userId,
    }),
  );
}

/** The invited user, after first login. Returns the memberships it activated. */
export async function acceptMembership(
  client: CloxaClient,
): Promise<Returns<"rpc_accept_membership">> {
  return unwrap("rpc_accept_membership", await client.rpc("rpc_accept_membership"));
}

export const signOutEverywhereInput = z.strictObject({ employeeId: uuid });
export type SignOutEverywhereInput = z.input<typeof signOutEverywhereInput>;

/**
 * Privileged, fresh MFA. Deletes every session of the employee's login (all
 * orgs). Access tokens already issued stay valid until they expire.
 * Returns the number of sessions revoked.
 */
export async function signOutEverywhere(
  client: CloxaClient,
  input: SignOutEverywhereInput,
): Promise<number> {
  const parsed = signOutEverywhereInput.parse(input);
  return unwrap(
    "rpc_sign_out_everywhere",
    await client.rpc("rpc_sign_out_everywhere", { p_employee_id: parsed.employeeId }),
  );
}

// Exports ----------------------------------------------------------------------------------

/** Inclusive Europe/Brussels days per export, and the stored snapshot size cap. */
export const MAX_EXPORT_PERIOD_DAYS = 62;
export const MAX_EXPORT_CONTENT_BYTES = 10 * 1024 * 1024;

const exportPeriod = <T extends { periodFrom: string; periodTo: string }>(value: T) => {
  const days =
    (Date.parse(`${value.periodTo}T00:00:00Z`) -
      Date.parse(`${value.periodFrom}T00:00:00Z`)) /
    DAY_MS;
  return days >= 0 && days < MAX_EXPORT_PERIOD_DAYS;
};
const exportPeriodMessage = {
  message: `period must be 1 to ${MAX_EXPORT_PERIOD_DAYS} days`,
  path: ["periodTo"],
};

export const createExportInput = z
  .strictObject({
    organizationId: uuid,
    periodFrom: localDate,
    periodTo: localDate,
    /** Null: the whole organization (owner/admin). Sorted and distinct, like the content. */
    siteIds: z
      .array(uuid)
      .min(1)
      .max(500)
      .refine(
        (ids) => ids.every((id, index) => index === 0 || (ids[index - 1] ?? "") < id),
        { message: "sites must be sorted and distinct" },
      )
      .nullable(),
    rowCount: z.int().min(0),
    /** The canonical JSON snapshot, byte for byte what was signed. */
    content: z
      .string()
      .min(2)
      .refine(
        (value) => new TextEncoder().encode(value).length <= MAX_EXPORT_CONTENT_BYTES,
        { message: "content is too large" },
      ),
    signatureHex: z.string().regex(/^[0-9a-f]{128}$/),
    signingKeyId: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  })
  .refine(exportPeriod, exportPeriodMessage);
export type CreateExportInput = z.input<typeof createExportInput>;

/**
 * Privileged, fresh MFA, within the caller's site scope. Stores a snapshot
 * the web server built and signed. Returns the export id.
 */
export async function createExport(
  client: CloxaClient,
  input: CreateExportInput,
): Promise<string> {
  const parsed = createExportInput.parse(input);
  const args = {
    p_org: parsed.organizationId,
    p_period_from: parsed.periodFrom,
    p_period_to: parsed.periodTo,
    p_site_ids: parsed.siteIds,
    p_row_count: parsed.rowCount,
    p_content: parsed.content,
    p_signature: bytea(parsed.signatureHex),
    p_signing_key_id: parsed.signingKeyId,
  };
  return unwrap(
    "rpc_create_export",
    // The generated types don't model a SQL null site list.
    await client.rpc(
      "rpc_create_export",
      args as Functions["rpc_create_export"]["Args"],
    ),
  );
}

export const recordExportDownloadInput = z.strictObject({
  /** The organization selected in the app; the export must belong to it. */
  organizationId: uuid,
  exportId: uuid,
  format: z.enum(["csv", "json"]),
});
export type RecordExportDownloadInput = z.input<typeof recordExportDownloadInput>;

/**
 * Privileged, fresh MFA, in scope, and the export belongs to `organizationId`.
 * Writes the `export.downloaded` audit row,
 * then returns the stored export. The only way to read export content: call
 * it before every download.
 */
export async function recordExportDownload(
  client: CloxaClient,
  input: RecordExportDownloadInput,
): Promise<Row<"rpc_record_export_download">> {
  const parsed = recordExportDownloadInput.parse(input);
  const rows = unwrap(
    "rpc_record_export_download",
    await client.rpc("rpc_record_export_download", {
      p_org: parsed.organizationId,
      p_export_id: parsed.exportId,
      p_format: parsed.format,
    }),
  );
  return first("rpc_record_export_download", rows);
}

export const recordExportIntegrityFailureInput = z.strictObject({
  organizationId: uuid,
  exportId: uuid,
  reason: z.enum(["hash", "signature"]),
});
export type RecordExportIntegrityFailureInput = z.input<
  typeof recordExportIntegrityFailureInput
>;

/** Same access as a download. Audits a stored export that failed its hash or signature check. */
export async function recordExportIntegrityFailure(
  client: CloxaClient,
  input: RecordExportIntegrityFailureInput,
): Promise<void> {
  const parsed = recordExportIntegrityFailureInput.parse(input);
  const { error } = await client.rpc("rpc_record_export_integrity_failure", {
    p_org: parsed.organizationId,
    p_export_id: parsed.exportId,
    p_reason: parsed.reason,
  });
  if (error) throw new RpcError("rpc_record_export_integrity_failure", error);
}

export const recordSelfExportInput = z
  .strictObject({ employeeId: uuid, periodFrom: localDate, periodTo: localDate })
  .refine(exportPeriod, exportPeriodMessage);
export type RecordSelfExportInput = z.input<typeof recordSelfExportInput>;

/** The employee's own row only. Audits a download of their own hours. */
export async function recordSelfExport(
  client: CloxaClient,
  input: RecordSelfExportInput,
): Promise<void> {
  const parsed = recordSelfExportInput.parse(input);
  const { error } = await client.rpc("rpc_record_self_export", {
    p_employee_id: parsed.employeeId,
    p_period_from: parsed.periodFrom,
    p_period_to: parsed.periodTo,
  });
  if (error) throw new RpcError("rpc_record_self_export", error);
}

// Kiosk (ADR 005) --------------------------------------------------------------------------

/** 32 random bytes as lowercase hex: the kiosk's device secret. */
const deviceSecret = z.string().regex(/^[0-9a-f]{64}$/);
/** Format only; the database also refuses trivial PINs (`pin_too_simple`). */
const pinDigits = z.string().regex(/^[0-9]{4,6}$/);

/** Pairing codes: 8 of these 32 symbols (no I, O, 0 or 1). */
export const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PAIRING_CODE_LENGTH = 8;
const pairingCode = z.string().regex(/^[A-HJ-NP-Z2-9]{8}$/);

export const kioskCreateInput = z.strictObject({
  siteId: uuid,
  name: shortText(100),
});
export type KioskCreateInput = z.input<typeof kioskCreateInput>;

export interface KioskPairingCode {
  pairingCode: string;
  expiresAt: string;
}

/** Owner or admin, fresh MFA. Returns the new kiosk and its one-time pairing code. */
export async function kioskCreate(
  client: CloxaClient,
  input: KioskCreateInput,
): Promise<KioskPairingCode & { deviceId: string }> {
  const parsed = kioskCreateInput.parse(input);
  const row = first(
    "rpc_kiosk_create",
    unwrap(
      "rpc_kiosk_create",
      await client.rpc("rpc_kiosk_create", {
        p_site_id: parsed.siteId,
        p_name: parsed.name,
      }),
    ),
  );
  return {
    deviceId: row.device_id,
    pairingCode: row.pairing_code,
    expiresAt: row.expires_at,
  };
}

export const kioskDeviceInput = z.strictObject({ deviceId: uuid });
export type KioskDeviceInput = z.input<typeof kioskDeviceInput>;

/** Owner or admin, fresh MFA. Replaces any outstanding code of the kiosk. */
export async function kioskNewPairingCode(
  client: CloxaClient,
  input: KioskDeviceInput,
): Promise<KioskPairingCode> {
  const parsed = kioskDeviceInput.parse(input);
  const row = first(
    "rpc_kiosk_new_pairing_code",
    unwrap(
      "rpc_kiosk_new_pairing_code",
      await client.rpc("rpc_kiosk_new_pairing_code", { p_device_id: parsed.deviceId }),
    ),
  );
  return { pairingCode: row.pairing_code, expiresAt: row.expires_at };
}

/** Owner or admin, fresh MFA. The tablet stops working at once. */
export async function kioskRevoke(
  client: CloxaClient,
  input: KioskDeviceInput,
): Promise<void> {
  const parsed = kioskDeviceInput.parse(input);
  const { error } = await client.rpc("rpc_kiosk_revoke", {
    p_device_id: parsed.deviceId,
  });
  if (error) throw new RpcError("rpc_kiosk_revoke", error);
}

export const setEmployeePinInput = z.strictObject({ employeeId: uuid, pin: pinDigits });
export type SetEmployeePinInput = z.input<typeof setEmployeePinInput>;

/** Privileged, fresh MFA, manager-scoped (managers: role `employee` or no login). */
export async function setEmployeePin(
  client: CloxaClient,
  input: SetEmployeePinInput,
): Promise<void> {
  const parsed = setEmployeePinInput.parse(input);
  const { error } = await client.rpc("rpc_set_employee_pin", {
    p_employee_id: parsed.employeeId,
    p_pin: parsed.pin,
  });
  if (error) throw new RpcError("rpc_set_employee_pin", error);
}

export const setMyPinInput = z.strictObject({ pin: pinDigits });
export type SetMyPinInput = z.input<typeof setMyPinInput>;

/** The caller's own PIN, in every organization they work for. No MFA needed. */
export async function setMyPin(
  client: CloxaClient,
  input: SetMyPinInput,
): Promise<number> {
  const parsed = setMyPinInput.parse(input);
  return unwrap(
    "rpc_set_my_pin",
    await client.rpc("rpc_set_my_pin", { p_pin: parsed.pin }),
  );
}

// Kiosk device calls: the anon client, no session. Refusals come back as rows,
// so the database keeps the failure record; only a broken call throws.

export const kioskPairInput = z.strictObject({ code: pairingCode });
export type KioskPairInput = z.input<typeof kioskPairInput>;

export type KioskPairResult =
  { ok: true; deviceSecret: string; deviceName: string } | { ok: false; error: string };

/** Unknown, used and expired codes all answer `code_invalid`; `pairing_paused` after 50 failures. */
export async function kioskPair(
  client: CloxaClient,
  input: KioskPairInput,
): Promise<KioskPairResult> {
  const parsed = kioskPairInput.parse(input);
  const row = first(
    "rpc_kiosk_pair",
    unwrap(
      "rpc_kiosk_pair",
      await client.rpc("rpc_kiosk_pair", { p_code: parsed.code }),
    ),
  );
  // The generated types don't model SQL nulls in returned rows.
  const secret = row.device_secret as string | null;
  const error = row.error_code as string | null;
  if (!row.ok || secret === null) return { ok: false, error: error ?? "code_invalid" };
  return { ok: true, deviceSecret: secret, deviceName: row.device_name };
}

export const kioskRosterInput = z.strictObject({ deviceSecret });
export type KioskRosterInput = z.input<typeof kioskRosterInput>;

export interface KioskRosterEntry {
  employeeId: string;
  displayName: string;
  initials: string;
  hasPin: boolean;
}

/** Throws `device_unknown` (unpaired or revoked) or `device_paused`. Updates last seen. */
export async function kioskRoster(
  client: CloxaClient,
  input: KioskRosterInput,
): Promise<KioskRosterEntry[]> {
  const parsed = kioskRosterInput.parse(input);
  const rows = unwrap(
    "rpc_kiosk_roster",
    await client.rpc("rpc_kiosk_roster", { p_device_secret: parsed.deviceSecret }),
  );
  return rows.map((row) => ({
    employeeId: row.employee_id,
    displayName: row.display_name,
    initials: row.initials,
    hasPin: row.has_pin,
  }));
}

export type KioskShiftState = "off" | "working" | "on_break";

export type KioskResult =
  | { ok: true; state: KioskShiftState; occurredAt: string | null }
  | {
      ok: false;
      /** device_unknown, device_paused, pin_invalid, pin_locked, invalid_transition or invalid_input. */
      error: string;
      triesLeft: number | null;
      retryAfterSeconds: number | null;
    };

/** A kiosk status/clock row, with the SQL nulls the generated types leave out. */
interface KioskRow {
  ok: boolean;
  error_code: string | null;
  tries_left: number | null;
  retry_after: number | null;
  state: string | null;
  occurred_at: string | null;
}

function kioskResult(rpc: string, rows: readonly KioskRow[]): KioskResult {
  const row = first(rpc, rows);
  if (
    row.ok &&
    (row.state === "off" || row.state === "working" || row.state === "on_break")
  ) {
    return { ok: true, state: row.state, occurredAt: row.occurred_at };
  }
  return {
    ok: false,
    error: row.error_code ?? "invalid_input",
    triesLeft: row.tries_left,
    retryAfterSeconds: row.retry_after,
  };
}

export const kioskStatusInput = z.strictObject({
  deviceSecret,
  employeeId: uuid,
  pin: pinDigits,
});
export type KioskStatusInput = z.input<typeof kioskStatusInput>;

/** Needs the PIN; a wrong one counts towards the lockout. Never returns hours. */
export async function kioskStatus(
  client: CloxaClient,
  input: KioskStatusInput,
): Promise<KioskResult> {
  const parsed = kioskStatusInput.parse(input);
  const rows = unwrap(
    "rpc_kiosk_status",
    await client.rpc("rpc_kiosk_status", {
      p_device_secret: parsed.deviceSecret,
      p_employee_id: parsed.employeeId,
      p_pin: parsed.pin,
    }),
  );
  return kioskResult("rpc_kiosk_status", rows);
}

export const kioskClockInput = z.strictObject({
  deviceSecret,
  employeeId: uuid,
  pin: pinDigits,
  type: liveClockType,
  idempotencyKey: uuid,
});
export type KioskClockInput = z.input<typeof kioskClockInput>;

/** Records the event at the kiosk's site. Idempotent per key; `state` is the new state. */
export async function kioskClock(
  client: CloxaClient,
  input: KioskClockInput,
): Promise<KioskResult> {
  const parsed = kioskClockInput.parse(input);
  const rows = unwrap(
    "rpc_kiosk_clock",
    await client.rpc("rpc_kiosk_clock", {
      p_device_secret: parsed.deviceSecret,
      p_employee_id: parsed.employeeId,
      p_pin: parsed.pin,
      p_type: parsed.type,
      p_idempotency_key: parsed.idempotencyKey,
    }),
  );
  return kioskResult("rpc_kiosk_clock", rows);
}
