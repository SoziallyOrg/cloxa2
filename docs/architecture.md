# Architecture (core contract)

This is the contract every implementer builds against. Change it by PR, together with an
ADR.

## Principles

- **Clients read, the database decides.** Browser and mobile clients read through RLS.
  Every mutation is a `public.rpc_*` wrapper that calls a `private.*` SECURITY DEFINER
  function (`set search_path = ''`). Only the wrappers are granted to `authenticated`.
- **Facts are appended, never edited.** `clock_events` and `audit_log` reject UPDATE,
  DELETE and TRUNCATE through triggers. A correction appends new events that supersede
  old ones.
- **Server time is authoritative.** `server_at = clock_timestamp()`. Client time is
  stored only as `client_captured_at`, for offline sync and skew flags.
- **Shifts are derived.** Shifts are computed from effective events by `@cloxa/domain`,
  which web, mobile and exports all share. The DB still enforces valid transitions on
  insert.

## Tenancy and identity

| Table              | Key columns                                                                                     | Notes                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `organizations`    | id, name, timezone (default `Europe/Brussels`), settings jsonb                                  | settings: `location_capture` (off/clock_points), `retention_years` (≥5)                                                |
| `sites`            | id, organization_id, name, address, timezone, active                                            | multi-site from day one                                                                                                |
| `memberships`      | id, organization_id, user_id → auth.users, role, status                                         | role: `owner`/`admin`/`manager`/`employee`; status: `invited`/`active`/`suspended`; unique (org, user)                 |
| `employees`        | id, organization_id, user_id (nullable), display_name, employee_code, statute, language, active | a worker **without a login** (kiosk-only) is valid; statute: `bediende`/`arbeider`/`student`/`flexi`/`interim`/`other` |
| `site_assignments` | organization_id, site_id, employee_id or membership_id                                          | employees → sites they clock at; managers → sites they manage                                                          |

Every tenant table carries `organization_id`. Composite foreign keys
`(organization_id, id)` keep cross-tenant references impossible. Organization and site
timezones must be names from `pg_timezone_names` (enforced by a trigger).

**Visibility**

- **Employee:** sees own `employees` row and own events.
- **Manager:** sees employees and events of assigned sites.
- **Admin and owner:** see the whole org.

**Privileged roles** (`owner`, `admin`, `manager`) require fresh MFA for every
privileged read and write: `aal2` in the JWT **and** a `totp`/`webauthn` entry in `amr`
that is at most 12 hours old (missing or malformed claims fail closed). This is enforced
in the database by `private.has_fresh_mfa()`, used by
`private.require_privileged(org_id)` and the RLS helpers, not only in the UI. The
30-minute idle timeout lives in app code; the database cannot see idleness. Without
fresh MFA a privileged member sees only their own rows, like an employee.

## Time facts

**`clock_events`** (append-only, hash-chained per organization)

- **Identity:** `id`, `organization_id`, `site_id`, `employee_id`.
- **Event:** `type` is one of `clock_in`, `clock_out`, `break_start`, `break_end` or
  `void`.
- **Timing:**
  - `occurred_at` is the time the fact refers to. It equals `server_at` for live
    clocking and the approved time for corrections. The append trigger enforces
    `occurred_at = server_at` for every non-`correction` source.
  - `server_at` is the insert time, stamped by the append trigger.
  - `client_captured_at` is nullable.
- **Provenance:**
  - `source` is one of `app`, `kiosk`, `mobile` or `correction`.
  - `device_id` is nullable.
  - `geo` is nullable: one point, only when the org setting allows it.
- **Links:**
  - `supersedes_event_id` is nullable. The row it points to stops being effective.
  - `correction_id` is nullable.
- **Integrity:**
  - `actor_user_id` (not null). Who the actor is for kiosk events of workers without a
    login is still to be decided in Phase 3.
  - `idempotency_key` is unique per `(organization_id, employee_id)`. A replay with the
    same key returns the original event; one employee's key never touches another's.
  - `prev_hash` and `hash` (bytea).

**Hash chain**

- `hash = sha256(prev_hash || canonical_bytes(row))`. The first event in an org uses 32
  zero bytes as `prev_hash`.
- Canonical bytes (`clock_events`): UTF-8 of the `|`-joined id, org, site, employee,
  type, `occurred_at` and `server_at` (both as epoch µs), `client_captured_at` (epoch
  µs), source, `supersedes_event_id`, `correction_id`, `actor_user_id`, `device_id`,
  `geo` (jsonb text). Every null is an empty field (`concat_ws` skips nulls, so each
  nullable value is coalesced).
- Canonical bytes (`audit_log`): id, org, `actor_user_id`, action, entity, `entity_id`,
  `metadata` (jsonb text) and `created_at` (epoch µs), same rules.
- Appends take `pg_advisory_xact_lock` on the org, so the chain is linear; unique
  `(organization_id, prev_hash)` makes a fork impossible.
- `private.hash_chain_heads` stores each chain's head (id, hash, length) so an append
  finds its predecessor in O(1). Verification walks the links from genesis and uses the
  head only to detect a removed tail or an edited head.
- `private.verify_clock_chain(org_id)` / `verify_audit_chain(org_id)` return the first
  broken row, or null (`service_role` may call them). Owners with fresh MFA use
  `public.rpc_verify_chains(org)`.
- **Lock order** inside one transaction: 1003 (per employee) → 1002 (clock chain, per
  org) → 1001 (audit chain, per org). Correction approval and withdrawal follow it, and
  corrections reject an `occurred_at` in the future. The auth limiter uses 1004 (email
  hash) → 1005 (IP hash) and never combines them with the other locks.

**Effective events** are events that no other event supersedes; a `void` supersedes
without replacing.

**Valid transitions** per employee, on effective events ordered by `occurred_at`:

- `off → clock_in → working`
- `working → break_start → on_break → break_end → working`
- `working → clock_out → off`

Live clock RPCs enforce this under a per-employee lock. Correction approval re-validates
everything from the earliest affected event to the latest one, under the same lock.

**`schedules`** (versioned, never overwritten)

- Columns: `employee_id`, `version` (per employee), `valid_from`, `pattern` jsonb,
  `notified_at` (server time the version was published to the employee), `created_by`.
  Append-only through triggers; audit rows record who set what.
- `pattern`:
  `{ "mon": [{ "start": "08:00", "end": "12:00" }], …, "exceptions": [{ "date", "blocks" }] }`.
  Local wall times in the org timezone; per day at most 6 sorted, non-overlapping
  blocks; only the last may cross midnight; `24:00` is a valid end; at most 100
  exceptions; at most 16 KiB. Checked by `private.is_valid_schedule_pattern`.
- The version in force on a day has the latest `valid_from` on or before it (highest
  `version` on ties). An exception replaces that day's blocks (`[]` = day off).
- `rpc_set_schedule(employee, valid_from, pattern)`: privileged with fresh MFA,
  manager-scoped. `valid_from` within one year back and two years ahead.
- `rpc_schedule_for(employee, from, to)`: at most 93 days, rows
  `{day, start_at, end_at}` expanded in the org timezone, so DST days get their real
  length. A nonexistent local time moves forward by the gap; an ambiguous one resolves
  to the later (standard-time) instant; blocks that collapse to zero length are dropped.
- It is the baseline for deviation reporting. Part-time schedule notices must be given
  at least 7 working days ahead (`legal-notes.md` §1.2).

**`correction_requests`**

- Columns: `employee_id`, `requested_by`, `kind` (`add`, `adjust` or `remove`),
  `target_event_ids`, `proposed` jsonb, `reason` (≤280 chars, UI warns: no medical
  details), status (`pending`, `approved`, `rejected` or `withdrawn`), `decided_by`,
  `decided_at`, `decision_note` (≤280). Only the decision of a pending request may
  change, once; rows are never deleted.
- `proposed = {"events": [...]}`: `add` 1–8 `{type, occurred_at, site_id}` at assigned,
  active sites; `adjust` one `{target_event_id, occurred_at}` per target (type and site
  kept); `remove` none. Times are ISO 8601 with an explicit offset, strictly increasing
  within one proposal, and never equal to an effective event of the employee (checked at
  request and again at approval).
- `rpc_request_correction`: the caller's own effective events only. Proposed times (and
  targets) must be at most `settings.correction_max_age_days` old (org setting, 1–365,
  default 60) and not in the future. The proposal is replayed against the live
  transition rules up front. At most 20 pending requests per employee.
- `rpc_withdraw_correction`: the requester, while pending.
- `rpc_decide_correction(id, 'approved'|'rejected', note)`: privileged with fresh MFA,
  manager-scoped. Managers and admins never decide their own request; an owner must. An
  owner may decide their own (single-owner businesses); the decision's audit row then
  carries `self_decided: true`. Approval, in one transaction under the employee lock:
  re-checks that the targets are still effective, replays the employee's effective
  events from the earliest affected instant to the end with the live rules
  (`invalid_sequence` otherwise, nothing changes), then appends events with
  `source='correction'`, `correction_id`, `supersedes_event_id` and `occurred_at` = the
  proposed time (`remove` appends `void` events at the original time). Each appended
  event gets its own `clock_event.recorded` audit row, plus one for the decision. The
  original events stay forever.

## Onboarding and members

- `rpc_admin_create_organization` (service_role): wraps `private.create_organization`.
- `invitations`: org, lowercased email, role (`admin`/`manager`/`employee`), employee,
  site ids, status (`pending` → `linked` → `accepted`, or `revoked`), `expires_at`
  (created + 7 days). One open invitation per email and org; an expired one is closed
  (as `revoked`, cause `expired` in the audit row) when the email is invited again. No
  token: Supabase owns the invite link.
- `rpc_revoke_invitation(id)`: privileged with fresh MFA; owners and admins revoke any
  open invitation, a manager only their own. Closing removes the never-activated
  membership and login link, and deactivates the invitation's employee row. Revoked or
  expired invitations can be neither linked nor accepted.
- `rpc_invite_member`: privileged with fresh MFA. Managers invite only employees, only
  onto sites they manage; owners and admins may invite managers and admins. Creates the
  employee row (no login yet) and its site assignments; returns the invitation id.
- The server action then calls `auth.admin.inviteUserByEmail` and
  `rpc_link_invited_user(invitation, user)` (service_role). Linking requires the auth
  user's email to match, creates the membership with status `invited`, attaches the
  login to the employee row and, for managers, the managed sites.
- `rpc_accept_membership()`: the invited user activates their linked, unexpired
  memberships (never a suspended one).
- `rpc_sign_out_everywhere(employee)`: privileged with fresh MFA (managers: employees
  only; owners only by an owner). Deletes the login's `auth.sessions` (cascading to
  refresh tokens); access tokens already issued live until they expire. Sessions belong
  to the login, not to an org, so this signs the user out of **every** organization they
  belong to, not only the caller's.

## Audit

**`audit_log`** is append-only and hash-chained per org, the same way as `clock_events`.

- Columns: `actor_user_id`, `action`, `entity`, `entity_id`, `metadata` jsonb.
- `metadata` holds no free-text reasons and no PII beyond IDs.
- Every mutating RPC writes at least one row (through `private.write_audit`); a
  correction approval writes one per appended event plus one for the decision. Export
  downloads write one too. Tenant-less calls (the attempt limiter) have no audit row.
- A daily root hash is anchored externally (Phase 4).

## Auth and sessions

- Signup is disabled; accounts exist only by invitation.
- **Employees** sign in with an email one-time code or a magic link. The same email
  carries both. Passkeys come later. There is no password. They stay signed in on their
  own device (see ADR 002).
- **Privileged roles** use TOTP, or a passkey once Supabase supports it.
  - Their JWT must carry `aal2`.
  - The app enforces a 30-minute idle timeout and a 12-hour absolute limit. When either
    expires, the user must re-verify MFA.
  - Recovery codes are hashed and single-use. **TODO:** not built yet; until then a lost
    TOTP factor is reset by an operator with the Auth admin API.
  - The idle clock is the signed httpOnly cookie `cx_act`, refreshed by `proxy.ts` on
    `/manage` requests; the `/manage` layouts and pages decide with the same pure
    function (`apps/web/src/lib/auth/mfa.ts`).
- Auth calls (OTP request and verification) go through server actions that check the
  attempt limiter below first. Supabase's own rate limits then see the server, so the
  per-IP limits here use the client IP from the trusted proxy header.
- **Turnstile** (optional): when `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are
  both set, the `/login` request form and the `/auth/confirm` POST carry a Cloudflare
  Turnstile token, checked server-side (siteverify, with the expected action) before the
  limiter, so bots cannot use up a real person's limits. Only then does the CSP allow
  `https://challenges.cloudflare.com` in `script-src` and `frame-src`. Off locally and
  in e2e; setting only one key fails at startup.
- **Attempt limiting** (`private.auth_attempts`, keyed HMAC-SHA256 hashes only, pepper
  `AUTH_HASH_PEPPER`; ADR 003). The server calls
  `rpc_auth_attempt(kind, email_hash, ip_hash, subject_hash)` (service_role) before
  every attempt and `rpc_auth_attempt_reset(key_hash)` after a success. Blocked calls
  are not recorded; rows older than 24 hours are purged by the call. No organization, so
  no audit row. When the client IP is unknown, `ip_hash` is null and every IP-keyed rule
  is skipped (there is no shared "unknown" bucket).
  - `otp_request`: 3 per email + IP and 20 per IP per 15 minutes; 10 per email per hour.
    A blocked request gets the same screen but no flow cookie, and the email is sent in
    `after()` so known and unknown addresses answer equally fast.
  - `otp_verify`: 5 failures per login flow (email plus a random nonce in the signed
    `cx_flow` cookie), then blocked 15 minutes; 30 per IP per 15 minutes. No per-email
    ceiling: typing wrong codes cannot lock out the real user's own flow.
  - `link_verify`: a check only; failures are recorded afterwards
    (`rpc_auth_link_failure`). 30 failures per IP per 15 minutes; 300 failures overall
    per 10 minutes pause link sign-in for everyone, and `/auth/confirm` asks people to
    type the code from the same email instead. `/auth/confirm` only renders a button on
    GET; the token is spent on the POST (server action), so mail scanners and cross-site
    pages cannot sign anyone in.
  - `totp_verify`: 5 failures per user id, then blocked 15 minutes; never the email key.
- **Client IP** (`CLOXA_PROXY_MODE`, required in production, `none` by default
  elsewhere): `vercel` trusts only `x-real-ip` (never `x-forwarded-for`); `append:<n>`
  takes the n-th `x-forwarded-for` hop from the right (for proxies that append); `none`
  trusts no header, so only the per-email and per-flow limits apply (logged once at
  startup). IPv6 is limited per /64. The IP is also forwarded to Supabase Auth as
  `X-Forwarded-For`; hosted Supabase may ignore it, so our limiter and Turnstile remain
  the backstop.
- **First TOTP factor**: after a successful `confirmEnrolment` the factors are listed
  again; if another verified TOTP factor exists (two enrolments raced), the new one is
  unenrolled and the user sees "Er is al een beveiligingsapp gekoppeld".
- The service key is used only in server-side code, never for reading or writing user
  data on a user's behalf: sending invitations (after the privileged, audited
  `rpc_invite_member`) and `rpc_link_invited_user`, `rpc_admin_create_organization`
  onboarding, and the attempt limiter.

## Packages

- **`@cloxa/domain`**
  - `deriveShiftState`, `effectiveEvents`, `deriveShifts` (gross, breaks, net, overnight
    handling), `deviationFromSchedule`.
  - Pure functions, fully unit-tested.
- **`@cloxa/db`**
  - Generated types, plus `rpc.*` typed wrappers with zod input schemas.
