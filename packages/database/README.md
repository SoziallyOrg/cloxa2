# `@cloxa/database`

## Phase 11A manager TOTP MFA

Manager access requires live Supabase Auth session at AAL2, matching `totp` AMR,
verified provider TOTP factor, and immutable first application registration for same
user/factor. RLS helpers and every manager RPC derive this shared assurance context.
AAL1 manager receives no manager tenant rows even through direct Data API. Employee
paths keep prior authorization semantics. Full schema, status, registration, recovery,
audit, and lock contract: [MANAGER_MFA.md](MANAGER_MFA.md).

## Phase 9 manager administration

[Manager team contract](MANAGER_TEAM.md) documents exact read/mutation RPC keys and
codes, authorization, private ledger, normalization, audit exclusions and lock order.
New namespace 17081 serializes all manager-administration request UUIDs; existing 17031
coordinates employees and exports, and 17022 coordinates reactivation admission. No
browser table-update grants or coworker profile policies are added. Suspended
memberships lose organization access without disabling Auth. Prior v1/v2 artifacts stay
byte-identical. Legacy optional invitation-code collisions leave code unassigned for
manager review, preserving invitation authorization and local-only email boundaries.

## Generated types and local database

This package exports TypeScript types generated from the local Supabase `public` schema.
Do not hand-edit `src/database.types.ts` or maintain duplicate database interfaces.
Next.js request clients stay in `apps/web` because they depend on request cookies.

Start the local stack before running database commands:

```bash
pnpm supabase:start
pnpm supabase:status
```

Create and inspect versioned migrations:

```bash
pnpm exec supabase migration new <descriptive_name>
pnpm exec supabase migration list --local
```

Rebuild, test, lint, and generate types from the local database:

```bash
pnpm supabase:reset
pnpm test:db
pnpm supabase:lint
pnpm supabase:types
pnpm supabase:types:check
```

Type generation passes CLI output through the repository Prettier configuration before
writing `src/database.types.ts`. The check command regenerates the same output in memory
and fails when the stored types differ.

## Authorization and invitation authentication

`public.memberships` is the authoritative source for organization roles. Authorization
helpers derive identity from `auth.uid()` and require an active membership in an
organization whose lifecycle is `research_pilot` or `paid_beta`. Manager helpers also
require registered native TOTP AAL2 assurance. They do not trust metadata, email
addresses, route names, browser state, or an AAL claim without matching live Auth rows
as proof of tenant access.

All application tables have RLS enabled. This matrix describes direct access through
`anon` and `authenticated` database roles:

| Table                 | Anonymous | Active employee               | Active manager with registered TOTP AAL2                                                          | Invited, inactive, absent membership, suspended organization, or manager without TOTP AAL2 | Direct browser writes                                                                                      |
| --------------------- | --------- | ----------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `profiles`            | None      | Own profile                   | Own profile and profiles of members in manager's organization, including invited/inactive members | Own profile                                                                                | Authenticated owner may update `display_name` and `locale`; no insert/delete or identity/timestamp changes |
| `organizations`       | None      | Own organization              | Own organization                                                                                  | None                                                                                       | None                                                                                                       |
| `worksites`           | None      | Worksites in own organization | Worksites in own organization                                                                     | None                                                                                       | None                                                                                                       |
| `memberships`         | None      | Own active membership         | Memberships in own organization, including invited/inactive members                               | None, including own membership                                                             | None                                                                                                       |
| `invitations`         | None      | None                          | Invitations in own organization                                                                   | None                                                                                       | None                                                                                                       |
| `audit_events`        | None      | None                          | Events in own organization                                                                        | None                                                                                       | None                                                                                                       |
| `time_entries`        | None      | Own entries while active      | Own organization while live and unambiguous                                                       | None                                                                                       | None                                                                                                       |
| `correction_requests` | None      | Own requests while active     | Own organization while live and unambiguous                                                       | None                                                                                       | None                                                                                                       |

Access applies per organization: losing access to one tenant does not remove a user's
separate active membership in another tenant. Suspension removes access to all rows
scoped to that organization. Users retain their own profile read/update permission
without active tenant access. Managers cannot edit another user's profile or change
roles, membership status, tenant assignment, or invitations through direct table writes.

`private.is_active_org_member(uuid)`, `private.has_org_role(uuid, text)`, and
`private.can_read_member_profile(uuid)` avoid recursive membership policies. These
`SECURITY DEFINER` helpers use a fixed empty `search_path`, schema-qualified references,
and the current authenticated identity. Only `authenticated` receives execution grants;
the `private` schema remains outside the API's exposed schemas.

All private functions have owner `postgres` and fixed `search_path = ''`:

| Function                                  | Security | Application-role EXECUTE |
| ----------------------------------------- | -------- | ------------------------ |
| `is_active_org_member`                    | DEFINER  | `authenticated`          |
| `has_org_role`                            | DEFINER  | `authenticated`          |
| `can_read_member_profile`                 | DEFINER  | `authenticated`          |
| `set_updated_at`                          | INVOKER  | None                     |
| `normalize_invitation_email`              | INVOKER  | None                     |
| `reject_audit_event_mutation`             | INVOKER  | None                     |
| `get_auth_context`                        | DEFINER  | `authenticated`          |
| `create_employee_invitation`              | DEFINER  | `authenticated`          |
| `get_employee_invitation_state`           | DEFINER  | `authenticated`          |
| `accept_employee_invitation`              | DEFINER  | `authenticated`          |
| `can_read_own_time_entry`                 | DEFINER  | `authenticated`          |
| `clock_in`                                | DEFINER  | `authenticated`          |
| `clock_out`                               | DEFINER  | `authenticated`          |
| `get_employee_time_clock`                 | DEFINER  | `authenticated`          |
| `resolve_brussels_local`                  | INVOKER  | None                     |
| `guard_correction_request_immutability`   | INVOKER  | None                     |
| `guard_correction_operation_immutability` | INVOKER  | None                     |
| `can_read_own_correction_request`         | DEFINER  | `authenticated`          |
| `submit_employee_correction_request`      | DEFINER  | `authenticated`          |
| `withdraw_employee_correction_request`    | DEFINER  | `authenticated`          |
| `get_employee_correction_requests`        | DEFINER  | `authenticated`          |
| `manager_review_organization`             | DEFINER  | `authenticated`          |
| `decide_correction_request`               | DEFINER  | `authenticated`          |
| `get_manager_correction_requests`         | DEFINER  | `authenticated`          |
| `guard_time_entry_history`                | INVOKER  | None                     |

The owner retains EXECUTE; `PUBLIC`, `anon`, and `service_role` have no EXECUTE grants.
Authenticated SQL callers invoke protected helpers through twelve `SECURITY INVOKER`
wrappers in `public`. Their definer implementations stay in the unexposed `private`
schema. Every protected helper binds identity to `auth.uid()` and a matching live
`auth.sessions` row. Trigger functions have no application EXECUTE grants. Neither
`anon` nor `service_role` can call the new RPCs.

| Public RPC                                                                  | Browser inputs                                                                           | Result                                                                                                                                  |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `get_auth_context()`                                                        | None                                                                                     | One `authorized`, `unauthorized`, or `unsupported` row; tenant and role appear only for one active membership in an active organization |
| `create_employee_invitation(employee_email, display_name?, employee_code?)` | Employee email and optional profile fields                                               | New invitation ID or a non-disclosing `NULL` duplicate/no-op                                                                            |
| `get_employee_invitation_state()`                                           | None                                                                                     | `ready`, `unavailable`, or `unsupported` for current verified Auth email                                                                |
| `accept_employee_invitation()`                                              | None                                                                                     | Activated employee membership ID                                                                                                        |
| `clock_in(request_id)`                                                      | Request UUID                                                                             | `started`, `already_working`, or the saved result for the same request                                                                  |
| `clock_out(request_id)`                                                     | Request UUID                                                                             | `stopped`, `already_stopped`, or the saved result for the same request                                                                  |
| `get_employee_time_clock()`                                                 | None                                                                                     | Current work state and today's own entries using the worksite timezone                                                                  |
| `submit_employee_correction_request(...)`                                   | Request UUID, kind, optional target, Brussels wall times, occurrence choices, and reason | New pending request or saved identical result                                                                                           |
| `withdraw_employee_correction_request(request_id, correction_request_id)`   | Operation request UUID and own request UUID                                              | `withdrawn`, `already_withdrawn`, or saved identical result                                                                             |
| `get_employee_correction_requests()`                                        | None                                                                                     | Recent closed entries and own request history                                                                                           |

Creation derives organization from caller's sole active manager membership, fixes role
to `employee`, normalizes email, expires invitations after 24 hours, and appends a
minimal creation audit. Acceptance requires a verified Auth email, password marker, live
matching session, one usable invitation, and no active membership. It creates or
preserves the profile, activates exactly one employee membership, marks invitation
accepted, and appends acceptance audit in one database transaction. Advisory and row
locks serialize competing operations. Browser callers cannot provide organization, role,
status, user, worksite, invitation ID, or expiry.

For `audit_events`, both `authenticated` and `service_role` have SELECT-only table
privileges. RLS limits authenticated reads to active managers in their own non-suspended
organizations. Employees and inactive or suspended-organization managers receive no
rows; `anon` has no SELECT privilege. Service-role clients bypass RLS and can read audit
rows across organizations, so keep them server-only. Service-role grants on the other
five tables permit controlled writes.

Neither browser roles nor `service_role` can INSERT, UPDATE, DELETE, or TRUNCATE audit
events. Row-level BEFORE UPDATE/DELETE and statement-level BEFORE TRUNCATE triggers use
`private.reject_audit_event_mutation()` to reject those mutations even for an owner SQL
statement. TRUNCATE needs its own guard because it ignores RLS and DELETE triggers.
Database owners can still alter or disable triggers; these guards are not tamper-proof
storage.

Invitation functions authenticate caller, check protected membership state, and append
audit events with authorized business changes in one transaction. Application roles
still receive no direct table INSERT privilege and no general audit-write RPC. Local
manager bootstrap uses a server-side secret client against a verified loopback stack; it
does not expose a database bootstrap endpoint. Audits contain no emails, profile fields,
secrets, authentication tokens, or links.

## Employee time clock

Employees start and stop work through authenticated RPCs. Browser sends an operation and
a request UUID; database derives user, membership, organization, worksite, and
timestamps. It rejects managers, inactive memberships, suspended organizations, expired
or missing live sessions, multiple active tenants, and organizations without exactly one
worksite.

A partial unique index permits one open entry per membership. Composite foreign keys
keep each entry's membership and worksite in the same organization. An unexposed request
ledger stores original result for safe retries. Advisory and row locks serialize
requests, so rapid or competing submissions create one state transition and one audit
event. Authenticated clients may read their own entries while their employee access
remains active. Browser and service roles receive no direct time-entry write grants.

State RPC calculates today's boundary in worksite's `Europe/Brussels` timezone and
returns timestamps as absolute instants. Interface formats those instants in same
timezone, including daylight-saving transitions. Breaks, direct manual factual records,
corrections, approvals, and exports remain outside time-clock RPC scope.

## Employee correction requests

Correction rows contain employee claims, not approved facts. Adjustment requests target
a closed own `time_entries` row and store immutable original start/end and
factual-version snapshots. Missed-entry requests carry no target or snapshot. Composite
foreign keys keep organization, employee membership, worksite, target entry, and
resolver membership tenant consistent. Status constraints support `pending`,
`withdrawn`, `approved`, and `rejected`; only submission, withdrawal, and manager
decision functions can write them.

Authenticated employees may select only own requests while their membership,
organization, Auth user, and session remain active. Live verified managers with exactly
one active membership read their own organization's requests. Anonymous users receive no
rows. Browser and service roles have no direct insert, update, or delete privileges.
Public invoker RPCs call private definer implementations with empty search paths and
derive identity, tenant, employee membership, role, status, worksite, and audit actor
from live locked state.

Dutch wall-clock input is normalized to `YYYY-MM-DDTHH:mm[:ss[.ffffff]]` without using
browser or server machine timezone, then `private.resolve_brussels_local` resolves it
against `Europe/Brussels`. Spring-forward gaps fail. Autumn repeated times require
`earlier` or `later`. Proposals must end strictly after start, end before database time,
change an adjustment, and avoid factual entries other than adjustment target. Pending
proposals for same employee may not overlap, and one pending adjustment may target an
entry.

Submission and withdrawal share time clock advisory-lock namespace and lock order.
Private operation ledger stores SHA-256 payload hashes and original outcomes per
employee/request UUID. Identical retries replay; changed operations or payloads fail
closed. Real submissions and withdrawals append one status-only audit in the same
transaction, without reasons or proposed timestamps. Approval's factual audit preserves
exact applied timestamps. Withdrawal affects only employee's own pending request and
does not modify, delete, replace, or mark target `time_entries`.

Request update/delete/truncate guards preserve submitted claims, target snapshots, and
creation fields. Terminal states cannot change. Ledger update/delete/truncate guards
preserve hashes and saved outcomes; its private table also enables RLS without
application policies. Database owners can alter or disable triggers, so these are
accidental-mutation guards, not tamper-proof storage. Public request reads require
exactly one active membership. The read RPC returns 20 recent closed entries and 50
recent requests; older rows remain stored but need a future history-pagination
interface.

Profile UPDATE privileges cover `display_name` and `locale` only, with RLS checking
`user_id = auth.uid()` before and after each update. Callers cannot write `user_id`,
`created_at`, or `updated_at`; the trusted trigger sets `updated_at` to the statement
timestamp. Profiles contain no organization, membership, role, or status fields, and
profile text does not grant authorization.

## Manager decisions and factual application

Migration `20260903094913_manager_correction_review.sql` adds request `manager_note`,
`applied_time_entry_id`, and `original_time_entry_version`; factual `version`, immutable
`origin`, and `last_correction_request_id`; plus private `manager_decision_operations`.
Existing resolution fields hold database decision time, manager membership, and
operation UUID. Manager identity/operation columns are excluded from authenticated
column-level SELECT grants and employee RPC results. Service-role SELECT remains
available for controlled local inspection; service role cannot invoke decision or review
RPCs or write facts, claims, decision operations, or audits.

`get_manager_correction_requests()` accepts no input and returns every own-tenant
pending request plus 50 recent terminal requests with name/code, original/proposed
intervals, reason, status, and decision explanation.
`decide_correction_request(request_id, correction_request_id, decision, manager_note)`
accepts only those four fields and returns `approved`, `rejected`, `already_decided`,
`stale_request`, `overlap`, `invalid_interval`, or `unavailable`, with request status
and the applied factual ID when appropriate.

Public decision/review RPCs are invokers calling private definers owned by `postgres`
with empty search paths and authenticated-only execution grants. The manager helper
checks effective authenticated role, Auth identity, verified email, ban/deletion,
matching live session, optional JWT expiry, exactly one active membership, manager role,
and active organization. It uses current database clock time and runs again after waits.
Employee target membership must be active or suspended, in the same tenant, and
associated with the sole worksite before approval. Active targets still require exactly
one active membership. Suspended historical targets remain reviewable even with another
active membership elsewhere; decisions never reactivate old-tenant access or alter
membership/Auth state. Invited/inactive targets remain unavailable for approval.
Employee direct factual reads and submissions/withdrawals retain their active,
exactly-one-membership boundary. Phase 9 repair replaces only the two private decision
implementations; public wrappers, grants, result shapes and codes stay unchanged.

Lock order: manager Auth rows; read immutable request references without row locks;
global decision UUID advisory lock (`17041`); target employee's existing advisory lock
(`17031`, hash of Auth user UUID); manager/employee memberships in ID order;
organization; worksites; all employee factual rows in ID order; target correction row.
Membership locks are shared, avoiding competing managers serializing or deadlocking
through an exclusive manager membership lock. Clock and employee correction operations
use the same employee advisory lock before their factual/request rows. The decision
never locks a correction row before that advisory lock. Manager Auth rows stay locked;
authorization and session expiry are rechecked after waits before mutation or replay.

Phase 4 facts deterministically become version 1 before existing adjustment requests are
backfilled from their tenant-bound targets. A kind-aware constraint is active for new
writes during backfill, then validated; the scoped immutability trigger pause is
restored inside the same migration transaction. New submissions capture target version
while its factual row is locked. Missed-entry requests keep the snapshot null. Version
history before this migration cannot be reconstructed: every Phase 4 fact starts at
version 1. Phase 4 application roles had no path for changing a closed targeted fact;
owner-side changes before versioning remain outside application integrity guarantees.

Adjustment approval reloads the target and compares start/end and version to the
immutable original snapshot. A changed, open, or ABA-restored target returns
`stale_request`. Application rechecks finite, strictly ordered, entirely past proposed
instants and overlap with all current employee facts, excluding the adjustment target.
Stale, invalid, overlapping, or unavailable applications leave requests pending and
facts/audits untouched. Rejection can resolve a stale or unavailable pending claim with
a required explanation; it never changes facts.

Approval changes the exact proposed timestamps or inserts one closed missed entry,
resolves the request, records an operation, and appends audits in one transaction. The
factual trigger increments version for every update, including clock-out. Existing rows
start at version 1 with origin `clock`; approved missed entries start at version 1 with
origin `approved_missed_entry`. Origin and identity/creation fields never change.
Tenant/employee/worksite composite foreign keys bind requests and applied facts. No
entry or request is deleted. Terminal requests and the private ledger reject
UPDATE/DELETE/TRUNCATE, including accidental owner SQL. Owners can still alter triggers;
these guards are not tamper-proof external storage.

Each global operation UUID binds manager membership, correction, decision, SHA-256 of
raw caller/request/intent/note, and the original outcome. Identical replay returns the
original result including `did_decide`; it does not repeat the mutation. Changed raw
note, decision, request, or manager fails closed. New UUIDs against terminal requests
return `already_decided`. Safe stale/overlap/unavailable outcomes are durable too:
identical UUID retries replay that outcome even if surrounding facts change.

Each real decision produces exactly one `correction_request.approved` or
`correction_request.rejected` audit with `{status}` before/after only. Each approval
also produces one `time_entry.adjusted` or `time_entry.missed_entry_added` audit whose
before/after fields are exactly `started_at`, `ended_at`, `version`, `origin`, and
`correction_request_id` (before is null for a missed entry). Actor is the authenticated
manager. No employee reason or manager note enters either audit. No-op or failed
decisions append no audit. Existing audit append-only guards and SELECT-only grants
remain intact.

UI history is bounded: all pending manager requests, 50 recent terminal manager
requests, 50 recent employee requests, and 20 recent closed employee facts. Full history
stays stored; correction pagination remains future work. Expired sessions, revoked
access, and ambiguous membership fail closed. Local tests use synthetic Auth users; no
hosted Supabase project is linked or accessed.

## Manager-confirmed factual exports

Migration `20260903141934_approved_time_exports.sql` adds:

- `public.time_exports`: tenant-owned manifest metadata with RLS and manager-only
  SELECT;
- `private.time_export_rows`: fixed ordered factual values with no browser/service-role
  grants or policies;
- `private.time_export_creation_operations`: global operation UUID, manager membership,
  SHA-256 raw-payload binding, original safe outcome, and optional export reference.

`preview_time_export(start,end)` is advisory.
`create_time_export(operation,start,end, confirmed)` repeats all checks under locks.
`get_manager_time_exports()` returns 20 recent manifests.
`get_time_export_snapshot(export_id)` reauthorizes current access and returns fixed rows
for server serialization. Public wrappers are invokers; private definers use empty
search paths. Each endpoint independently requires effective `authenticated`,
verified/non-banned/non-deleted Auth user, matching live unexpired session/JWT, exactly
one active manager membership, active research-pilot/paid-beta organization, and exactly
one worksite. Copied UUIDs remain tenant-scoped.

Dates are exact `YYYY-MM-DD` Brussels dates. Ranges are inclusive and at most 31 days;
their UTC interval is half-open from local start midnight through midnight after local
end. Eligibility uses finite, closed, strictly positive `time_entries` whose Brussels
local start falls in that interval. Complete overnight elapsed intervals remain assigned
to start date. Pending correction targets and overlapping pending proposals block, as do
overlapping open facts, empty selection, row limit, and conservative artifact-size
estimate. Rejected/withdrawn/approved corrections do not block; their resulting current
facts are selected.

Snapshot ordinals order membership ID, start, end, and entry ID. Rows preserve source
entry ID/version, optional code/name, worksite ID/name, canonical UTC/local timestamps,
exact decimal microseconds, origin, and nullable last correction reference. Manifest
schema is `cloxa.time-export.v1`; selection rule is `brussels-start-date.v1`. Dataset
SHA-256 covers UTF-8 canonical `jsonb` text of manifest inputs without hash plus ordered
rows. Exact totals and row durations leave RPCs as decimal strings, avoiding JavaScript
floating-point arithmetic.

Creation lock order is manager Auth/session, operation namespace `17051`, every tenant
employee's existing namespace `17031` ordered by hash/UUID, memberships, organization,
worksites, facts by ID, then corrections by ID. Manager authorization runs again after
waits. A single statement snapshot reads selected rows, names, codes, totals, and
blockers; the private STABLE selection helper shares that statement snapshot. Thus
correction approval either finishes before a final-version snapshot or stays pending and
blocks creation; clock-out similarly finishes first or leaves an open-entry blocker.
Manifest, rows, hash, safe audit, and operation outcome share one transaction.

All three tables reject UPDATE, DELETE, and TRUNCATE through owner-side accident guards.
Database owners can alter/disable triggers, so this is application/database-role
protection, not tamper-proof external storage. Later profile/code/membership/fact
changes do not rewrite captured values. Retention/deletion policy remains future work.

Server CSV uses UTF-8 BOM, CRLF, quote-all RFC 4180-style fields, doubled quotes, and a
leading apostrophe for user text beginning with Unicode whitespace, control/format
characters, or `=`, `+`, `-`, `@`. JSON uses stable keys, LF, explicit nulls, and exact
strings. Both repeat/reconcile manifest identity and dataset hash. Download Route
Handler reauthorizes through snapshot RPC, caps bytes at 10 MiB, and returns
attachment/no-store/nosniff plus artifact SHA-256. No download audit is recorded; only
actual snapshot creation uses `time_export.created`, with safe manifest summary and no
PII/free text.

See [export v1 contract](TIME_EXPORT_V1.md) for exact fields, canonical bytes, formats,
limits, and interpretation. Server validation recomputes the dataset hash before
serving.

## Live unpaid break facts

Migration `20260903230921_employee_live_breaks.sql` adds tenant-bound
`public.time_breaks` and private immutable `time_break_operations`. Composite foreign
keys bind organization, employee membership, worksite, and parent entry. Partial unique
indexes allow one open break per employee and parent. Insertion requires an open
version-1 fact; normal mutation only closes it and increments version. Closed updates,
identity/start/origin rewrites, deletion, and truncation fail. Guards also reject
nonpositive/nonfinite intervals, overlapping breaks, closed-parent starts, and parent
changes that would invalidate break containment. Owners can disable guards; this is not
tamper-proof storage.

`start_break(uuid)` and `end_break(uuid)` are public invoker wrappers around private
`change_live_break`. They derive ownership from verified/non-banned/non-deleted Auth
state, matching live session and JWT expiry, exactly one active employee membership,
active pilot/beta organization, and exactly one worksite. Both application roles lack
direct writes; employees read only their own facts and authorized managers read their
tenant's facts. The private ledger has no application read/write grants.

Lock order: Auth/session, operation UUID namespace `17061`, employee namespace `17031`,
memberships, organization, worksite, parent entry, break rows. Authorization is checked
after waits and before replay or mutation. UUID outcomes bind employee, operation type,
and SHA-256 of the exact allowed payload (authenticated actor and intent; UUID is the
ledger key). Identical retries return the fixed result; changed actor/intent fails.
Start/end fact, result, and `time_break.started`/`time_break.ended` audit commit
together. Audit JSON contains only factual IDs, status, timestamps, and version.

Clock-out joins the same break-row lock order and persists `open_break` refusal. An
identical blocked UUID remains blocked after the break ends; a new intent uses a new
UUID. Correction submission allows a nullable private claim reference only for durable
`break_conflict`; no claim is created. Approval adds the same result to its existing
ledger and leaves conflicting requests pending. Both inspect locked breaks, never edit
break facts, and append no factual/approval audit for refusal.

Read models add ordered break intervals. UI totals use integer microseconds: completed
shift gross minus completed contained breaks equals net. Open gross/net stay unknown;
open breaks never acquire an invented end. These are factual unpaid intervals, not
statutory-rest or payroll calculations. Historical changes use the additive Phase 8
request and revision model below.

Export selection adds a break blocker within the same creation statement snapshot.
Creation also locks tenant break rows after entries and before corrections. Existing
canonical snapshot/hash/serializer/download functions are unchanged. New v1 creation
intentionally refuses break-bearing selected facts until separately reviewed v2.

## Schema decisions and limits

- Organization foreign keys use `ON DELETE RESTRICT`, including audit history.
  Membership users, invitation senders and accepters, and audit actors also use
  `RESTRICT`. A future controlled deletion process must address those references;
  deleting a user or tenant must not erase audit history through a cascade.
- Profiles use `ON DELETE CASCADE` from `auth.users`. Other references can still block
  user deletion. Profile cleanup does not constitute a complete retention or erasure
  workflow.
- Invitation writes normalize surrounding spaces and letter case with
  `lower(btrim(normalized_email))`. A partial unique index permits one `pending`
  invitation per organization and normalized email. It does not merge provider-specific
  aliases such as plus-addresses.
- Passing `expires_at` does not change `pending` status or free that unique slot. The
  trusted creation RPC expires a stale invitation in caller's tenant before replacing
  it. No background expiry scheduler exists.
- `intended_role` permits `employee` only. Acceptance verifies current Auth user email
  against normalized invitation email. Manager creation remains a separate controlled
  local-development operation.
- Invitation constraints require expiry after creation and consistent status fields:
  `pending`/`expired` have no acceptance or revocation data; `accepted` requires an
  accepter and acceptance time from creation until before expiry, with no revocation;
  `revoked` requires revocation at or after creation, with no acceptance data. These
  checks validate stored rows; they do not implement status-transition authorization.
- Profile locale defaults to `nl-BE` and currently permits only `nl-BE`. Worksite
  timezone defaults to `Europe/Brussels`. Timestamps use `timestamptz`; mutable tables
  maintain `updated_at` through database triggers.
- Schema permits multiple worksites per organization for future use. Pilot time-clock
  and correction RPCs require exactly one worksite; no worksite-management UI exists.
- Correction reasons are trimmed and limited to 500 characters. Partial unique indexes
  enforce one pending adjustment per target and prevent exact duplicate pending
  intervals. Private transactional checks also reject any overlapping pending proposal
  for employee.

Hosted Supabase connections, deployment, paid resources, and real personal or customer
data remain prohibited. Development and tests use local synthetic data only. This phase
does not establish production readiness or implement direct manual factual records,
billing, social-secretariat delivery, payroll/declaration logic, statutory-rest rules,
automatic breaks, or broad product dashboards.

## Phase 8 historical break corrections

Migration `20260904082654_historical_break_corrections_export_v2.sql` adds tenant-bound
`break_correction_requests`, `time_break_revisions`, `time_exports_v2`, private request
and decision UUID ledgers, and private v2 snapshots/operations. Application roles have
no direct factual or ledger writes. Employee reads are own-only; manager reads remain
same-organization. Private `effective_time_breaks` is the single latest-state resolver,
including removal tombstones. Existing factual readers project its non-removed states.

[Time export v2](TIME_EXPORT_V2.md) documents exact tables, functions, result codes,
lock order, schemas, precision, serialization and audit. V1 stored facts, artifact
bytes, hashes and download routes remain unchanged. New v1 creation is fail-closed for
every entry with any break history. Owners able to disable triggers can bypass history
guards; these guards prevent application writes and accidental normal owner edits, not
administrator tampering.
