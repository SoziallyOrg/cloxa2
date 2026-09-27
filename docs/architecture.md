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
`(organization_id, id)` keep cross-tenant references impossible.

**Visibility**

- **Employee:** sees own `employees` row and own events.
- **Manager:** sees employees and events of assigned sites.
- **Admin and owner:** see the whole org.

**Privileged roles** (`owner`, `admin`, `manager`) require `aal2` in the JWT for every
privileged read and write. This is enforced in `private.require_privileged(org_id)` and
in RLS helpers, not only in the UI.

## Time facts

**`clock_events`** (append-only, hash-chained per organization)

- **Identity:** `id`, `organization_id`, `site_id`, `employee_id`.
- **Event:** `type` is one of `clock_in`, `clock_out`, `break_start`, `break_end` or
  `void`.
- **Timing:**
  - `occurred_at` is the time the fact refers to. It equals `server_at` for live
    clocking and the approved time for corrections.
  - `server_at` is the insert time.
  - `client_captured_at` is nullable.
- **Provenance:**
  - `source` is one of `app`, `kiosk`, `mobile` or `correction`.
  - `device_id` is nullable.
  - `geo` is nullable: one point, only when the org setting allows it.
- **Links:**
  - `supersedes_event_id` is nullable. The row it points to stops being effective.
  - `correction_id` is nullable.
- **Integrity:**
  - `actor_user_id`.
  - `idempotency_key` is unique per org.
  - `prev_hash` and `hash` (bytea).

**Hash chain**

- `hash = sha256(prev_hash || canonical_bytes(row))`. The first event in an org uses 32
  zero bytes as `prev_hash`.
- Canonical bytes: a `|`-joined text of id, org, site, employee, type, `occurred_at` and
  `server_at` (both as epoch µs), `client_captured_at` (or empty), source,
  `supersedes_event_id`, `correction_id` and `actor_user_id`, all UTF-8.
- Appends take `pg_advisory_xact_lock` on the org, so the chain is linear.
- `private.verify_clock_chain(org_id)` returns the first broken event, or null.

**Effective events** are events that no other event supersedes; a `void` supersedes
without replacing.

**Valid transitions** per employee, on effective events ordered by `occurred_at`:

- `off → clock_in → working`
- `working → break_start → on_break → break_end → working`
- `working → clock_out → off`

Live clock RPCs enforce this under a per-employee lock. Correction approval re-validates
the whole affected day.

**`schedules`** (versioned, never overwritten)

- Columns: `employee_id`, `valid_from`, `pattern` jsonb (weekly blocks plus exceptions),
  `notified_at`, `created_by`.
- It is the baseline for deviation reporting. Part-time schedule notices must be given
  at least 7 working days ahead (`legal-notes.md` §1.2).

**`correction_requests`**

- Columns: `employee_id`, `kind` (`add`, `adjust` or `remove`), `target_event_ids`,
  proposed times, `reason` (≤280 chars, UI warns: no medical details), status
  (`pending`, `approved`, `rejected` or `withdrawn`), `decided_by`, `decided_at`,
  `decision_note`.
- Approval appends events with `source='correction'`. The original events stay forever.

## Audit

**`audit_log`** is append-only and hash-chained per org, the same way as `clock_events`.

- Columns: `actor_user_id`, `action`, `entity`, `entity_id`, `metadata` jsonb.
- `metadata` holds no free-text reasons and no PII beyond IDs.
- Every RPC writes one row, and export downloads write one too.
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
  - Recovery codes are hashed and single-use.
- Auth calls (OTP request and verification) run from the browser client, so Supabase
  rate-limits the real client IP. Cloudflare Turnstile (the Supabase `auth.captcha`
  setting) is switched on in hosted environments.
- Invitations are sent by server actions with the service key. That is the only place
  the service key is used, and it runs behind a privileged check and an audit write.

## Packages

- **`@cloxa/domain`**
  - `deriveShiftState`, `effectiveEvents`, `deriveShifts` (gross, breaks, net, overnight
    handling), `deviationFromSchedule`.
  - Pure functions, fully unit-tested.
- **`@cloxa/db`**
  - Generated types, plus `rpc.*` typed wrappers with zod input schemas.
