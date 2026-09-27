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

/** Lowercase hex sha256 of the trimmed, lowercased email or of the client IP. */
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
const bytea = (hex: string) => `\\x${hex}`;

export const authAttemptInput = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("otp_request"),
    emailHash: sha256Hex,
    ipHash: sha256Hex,
  }),
  z.strictObject({
    kind: z.literal("otp_verify"),
    emailHash: sha256Hex,
    ipHash: sha256Hex.optional(),
  }),
]);
export type AuthAttemptInput = z.input<typeof authAttemptInput>;

/**
 * service_role only (secret-key client). Call before each OTP request and
 * verification; a blocked attempt is not recorded.
 */
export async function authAttempt(
  client: CloxaClient,
  input: AuthAttemptInput,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const parsed = authAttemptInput.parse(input);
  const rows = unwrap(
    "rpc_auth_attempt",
    await client.rpc("rpc_auth_attempt", {
      p_kind: parsed.kind,
      p_email_hash: bytea(parsed.emailHash),
      ...optional(
        "p_ip_hash",
        parsed.ipHash === undefined ? undefined : bytea(parsed.ipHash),
      ),
    }),
  );
  const row = first("rpc_auth_attempt", rows);
  return { allowed: row.allowed, retryAfterSeconds: row.retry_after };
}

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
