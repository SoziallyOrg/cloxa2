# Manager team administration contract

Phase 9 adds `/manager/team` for one manager context, one active organization and one
`Europe/Brussels` worksite. Target: 5–20 workers. No tenant switching, role changes,
transfers, deletion, Auth-account changes, resend or production mail.

## Authorization and grants

Four public SECURITY INVOKER wrappers call private SECURITY DEFINER functions. All fix
`search_path = ''`, qualify names and grant EXECUTE only to authenticated and owner.
PUBLIC, anon and service_role have no execution grant. `private.manager_admin_context()`
requires effective authenticated role, verified/non-deleted/non-banned Auth user,
matching JWT subject and live Auth session, unexpired session `not_after` and JWT `exp`
when present, exactly one active membership across all organizations, manager role,
active `research_pilot` or `paid_beta` organization and exactly one Brussels worksite.

Every read/mutation locks caller Auth user/session and repeats authorization after
waits. Target must remain an employee in that same organization after locking. Browser
supplies no actor, organization, worksite, current status or replacement role. Settings
derives entity IDs from live context. No new browser UPDATE grants or table-read
policies exist. Employee profile permissions remain exactly own `display_name` and
`locale`. No coworker enumeration or Auth-table access is granted. Existing RLS rejects
suspended memberships on subsequent statements; it does not cancel responses authorized
before suspension.

## Exact RPCs and responses

Each returns one JSON object, not a table/array. Every key is required; nullable values
use explicit JSON null. All requests take `request_id uuid` and return it. Read UUIDs do
not enter operation ledger. Invalid input raises 22023; denied context/target
raises 42501. Raw provider/database errors never reach UI.

### `get_manager_team(request_id uuid)`

Exact keys:

```text
request_id, organization_id, organization_name, worksite_id, worksite_name,
timezone, employees, invitations
```

Timezone is literal Europe/Brussels. At most 100 employees, ordered by lowercase display
name (null as empty), creation timestamp, membership UUID. Active, suspended, invited
and legacy inactive employees are included; managers are excluded. Employee keys:

```text
membership_id, display_name, employee_code, account_email, membership_status,
created_at, activated_at, has_open_shift, has_open_break,
pending_time_correction_count, pending_break_correction_count
```

Display name, code and account email can be null. Current legacy text is not truncated.
Account email comes only from same-tenant Auth join; missing email or soft-deleted user
produces null. No email is guessed. `activated_at` is earliest accepted invitation for
that user/organization, or null; no activation timestamp is invented. Counts are
nonnegative integers; flags report factual open intervals.

At most 100 invitations, ordered by creation descending, normalized email, internal UUID
as tie-breaker. UUID is not projected. Exact invitation keys:

```text
email, status, created_at, expires_at, accepted_at, revoked_at
```

Status is pending, accepted, expired or revoked. Elapsed pending invitations project as
expired without changing stored rows. Terminal timestamps remain nullable according to
status. Projection excludes Auth/session identifiers, password state, invitation IDs or
tokens, operation hashes, ledger identifiers and credentials.

### `update_employee_profile(request_id uuid, target_membership_id uuid, display_name text, employee_code text)`

Only active/suspended employee targets with existing profiles. Exact response keys:

```text
request_id, result_code, did_change, target_membership_id, display_name, employee_code
```

Codes: `updated` (did_change true), `unchanged` (false), `duplicate_employee_code`
(false). Blocker returns unchanged current profile. Success/no-op returns normalized
submitted values. Role, Auth identity/email, organization and factual data never change.

### `change_employee_membership_status(request_id uuid, target_membership_id uuid, action text, confirmed boolean)`

Action is exactly `suspend` or `reactivate`; explicit boolean true permits transition.
Exact response keys:

```text
request_id, result_code, did_change, target_membership_id, membership_status,
has_open_shift, has_open_break, pending_time_correction_count,
pending_break_correction_count
```

| Code                  | Meaning                                                        | did_change |
| --------------------- | -------------------------------------------------------------- | ---------- |
| suspended             | Active employee suspended, no open shift/break                 | true       |
| reactivated           | Same suspended membership restored, no other active membership | true       |
| already_suspended     | Suspend requested for suspended employee                       | false      |
| already_active        | Reactivate requested for active employee                       | false      |
| confirmation_required | Explicit confirmation absent                                   | false      |
| unavailable           | Invited or legacy inactive employee                            | false      |
| open_break            | Suspension blocked by open break; takes priority               | false      |
| open_shift            | Suspension blocked by open shift                               | false      |
| ambiguous_membership  | Reactivation would create another active membership            | false      |

Suspension never closes/synthesizes shifts or breaks, disables Auth, revokes sessions,
or deletes history. Pending requests remain manager-reviewable. UI shows counts before
confirmation. Reactivation updates same membership, preserving role, organization and
history. Existing admission lock coordinates invitation acceptance and reactivation. An
already-active no-op creates no access; existing role resolution still rejects ambiguous
active contexts. Safety never depends on best-effort session revocation.

### `update_pilot_settings(request_id uuid, organization_name text, worksite_name text)`

Both names update in one transaction. Exact response keys:

```text
request_id, result_code, did_change, organization_id, organization_name,
worksite_id, worksite_name, timezone
```

Codes: `updated` (true if either changed), `unchanged` (false). IDs, lifecycle, timezone
and worksite count cannot change. Returned IDs match server-derived current entities;
returned names match normalized submitted values.

## Validation and unique codes

PostgreSQL `btrim(text)` removes surrounding ASCII spaces. Manager display names: 1–100
Unicode code points. Organization/worksite names: 1–120. Optional code: at most 32;
empty/spaces become null. Control characters are rejected. Zod matches trim and
code-point bounds. Legacy values and existing self-profile permissions are not rewritten
or narrowed.

Non-null membership codes are unique within organization under
`lower(btrim(employee_code))`, including inactive/suspended memberships. Display/export
retains case. Index uses database collation, not Unicode compatibility normalization or
provider payroll mappings. Different organizations can reuse codes. Migration aborts on
existing normalized duplicates with 23505,
`memberships_normalized_employee_code_conflict`; resolution needs separate data review.
No silent historical rewrite occurs.

Legacy invitation codes remain optional proposals. Acceptance retains original Auth,
session, email, tenant, membership-state and local delivery checks. A conflict with new
unique index preserves existing membership code or leaves code null for manager review.
Only that named constraint exception is handled. No code is invented, another employee
overwritten, invitation payload changed or suspension bypassed. Response and invitation
audit shape stay unchanged. UI shows `Niet ingevuld`; exports retain existing
`missing_employee_code` warning.

## Lock order, ledger and replay

New advisory namespace **17081** serializes request UUID hashes across all Phase 9
mutations. Hash collisions only add waiting; full UUID/intent remain checked.

1. Caller Auth user/session FOR SHARE; initial authorized context.
2. 17081 request UUID; reactivation then takes existing 17022 target-user admission
   lock.
3. Existing 17031 employee serialization. Profile/status take target key. Settings takes
   all tenant employee keys ordered by signed `hashtext(user_id)`, then UUID, like
   exports.
4. Membership rows ordered by UUID: profile/status lock caller and target user's rows
   FOR UPDATE; settings locks tenant memberships FOR SHARE.
5. Organization, then worksites: FOR SHARE for employee changes; settings uses FOR
   UPDATE.
6. Profile FOR UPDATE for profile edit. Status: entries FOR UPDATE, then live breaks,
   time requests, break requests FOR SHARE, UUID ordered within each set.
7. Repeat live context/target checks, inspect immutable operation, mutate and atomically
   append audit(s) and operation result.

Read order: Auth, caller membership rows FOR SHARE, organization FOR SHARE, worksites
FOR SHARE, repeated context check, one projection statement. It needs no employee
advisory lock. Existing clock/live-break/correction/export workflows use 17031 before
membership/factual locks. Settings/profile changes serialize with export creation. Each
export sees complete old-or-new state of each atomic operation; separate submitted
profile/settings actions are separate transactions, not one batch.

Private ledger columns exactly: `request_id`, `organization_id`, `actor_membership_id`,
`target_entity_type`, `target_entity_id`, `action`, `payload_hash`, `result_code`,
`result`, `processed_at`. Request UUID is primary key across Phase 9. SHA-256 binds
JSONB array text of action, target(s), normalized payload/confirmation; actor is bound
separately. Settings hash includes worksite. Timestamp is database-controlled. Identical
authorized retries return original JSON exactly, including after later edits. Changed
actor/target/action/ payload raises 22023, `manager_team_request_id_reused`.

Ledger has RLS, no application grants/policies, and UPDATE/DELETE/TRUNCATE guards
raising 55000, `manager_team_operations are append-only`. This is not
administrator-proof history. Strict server Zod parsers check all keys, nullability,
UUID/entity correlation, action/ result and did_change semantics. Confirmed success,
no-op and safe blocker retire browser UUID. Uncertain transport/malformed results
preserve in-memory UUID. Changed payload has another key. Reload/tab close loses
in-memory retries; intent is never stored in URLs or browser storage.

## Audits and historical exports

- `employee_profile.updated`: one event per real edit, membership entity, changed field
  names only (`display_name`, `employee_code`).
- `employee_membership.suspended` / `.reactivated`: one event, before/after status only.
- `organization.settings_updated` / `worksite.settings_updated`: one per changed entity,
  `changed_fields: ["name"]`. Both names changed means two audits, one operation result.

No audit for retries, no-ops, rejection or blockers. Audit failure rolls back all writes
and result. Existing audit actor column retains established attribution. Audit JSON
excludes email/name/code text, notes, request payloads, Auth/session IDs, hashes, tokens
and secrets. Ledger stores only documented safe result projections.

Current name/code/worksite edits affect future UI and future snapshots where fields
already exist. Organization name is not an export field; Phase 9 does not add it.
Historical v1/v2 snapshots, hashes, CSV and JSON bytes remain unchanged. Suspended
employees' historical facts remain exportable under existing selection rules.

No public signup, production mail, resend, Auth deletion, MFA, multi-tenant switcher,
multiple sites, role/lifecycle controls, billing, scheduling, native app, deployment,
hosted Supabase or VPS access. No dependencies added. No payroll, wages, overtime,
statutory-rest, declaration, compliance or provider-acceptance claim.
