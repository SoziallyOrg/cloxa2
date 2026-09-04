# Database tests

Phase 9 `manager_team_administration.test.sql` covers strict safe roster projection, all
unsupported actor classes, unique normalized codes, protected direct writes,
UUID/action/actor/target binding, suspension blockers, same-membership reactivation,
complete history preservation, audit rollback and immutable ledger guards. Existing
Phase 1–8 files remain unchanged. Production `manager-team.spec.mts` supplies
real-session profile/UUID, clock/suspension, export/settings and post-wait expiry races,
plus desktop and exact 320px team journeys. Local teardown removes only each synthetic
test tenant; it never authorizes application behavior. No hosted resources or real
identities apply.

Run authorization, invitation, employee time-clock, and correction-request tests against
the local Supabase database:

```bash
pnpm supabase:start
pnpm supabase:reset
pnpm test:db
```

Tests create invented `auth.users`, profiles, and tenant fixtures inside transactions.
Each test file starts with `BEGIN` and ends with `ROLLBACK`; no persistent local users,
test-account login, email delivery, or seed data are required.

RLS assertions switch between `anon` and `authenticated` with Supabase JWT claims and
check the effective database role and `auth.uid()`. Employee, manager, inactive, and
suspended-organization cases verify tenant boundaries and denied writes. Privileged
fixture setup and schema-constraint checks do not replace browser-role authorization
tests. Coverage also checks profile field permissions, invitation normalization and
duplicate pending invitations, audit protection, and RLS configuration.

`employee_time_clock.test.sql` checks exact grants, tenant-consistent foreign keys, the
one-open-entry constraint, Brussels-local day history, and authorized RPC behavior. It
also covers inactive, suspended, sessionless, multi-tenant, and multi-worksite callers;
cross-tenant reads; forged inputs; idempotent retries; competing starts and stops; and
minimal audit payloads.

`employee_correction_requests.test.sql` checks tenant-consistent request and snapshot
references, exact grants and RLS, own-employee and manager tenant reads, closed-entry
ownership, direct-write denial, past and overlap rules, immutable factual rows,
idempotency hashes, withdrawal ownership, and status-only audits. Brussels conversion
cases cover ordinary dates, local midnight, overnight intervals, spring-forward gaps,
and both explicit autumn occurrences. Additional cases cover microsecond preservation,
immutable claim and ledger guards, replay after withdrawal, changed-payload rejection,
rejected/approved withdrawal denial, and live bans, deletion, session expiry, or tenant
suspension after claims exist. Real concurrent network calls live in
`apps/web/e2e/employee-corrections.spec.mts`; transaction-scoped SQL assertions do not
substitute for those races.

`authorization_boundaries.test.sql` adds exact audit table and profile column privilege
checks, direct private-function calls, and effective-role audit mutations including
TRUNCATE. An explicit `service_role` case tests cross-tenant audit reads through its
intended RLS bypass while proving that its audit writes still fail. Owner SQL tests
verify UPDATE/DELETE row triggers and the BEFORE TRUNCATE statement trigger reject audit
mutations with SQLSTATE `55000` (`audit_events are append-only`).

Keep new fixtures synthetic and transaction-scoped. Run against local Docker services
only; do not connect to hosted Supabase or import real personal or customer data. Tests
cover implemented database behavior, including manager-confirmed factual snapshots.

`manager_correction_review.test.sql` checks exact private-ledger columns, indexes,
constraints, owner/search paths/grants, safe browser column reads, and tenant-consistent
foreign keys. It exercises manager and employee read boundaries, all unsupported caller
states, service-role impersonation, exact microsecond application, missed-entry origin,
version capture and increments, rejection without factual change,
stale/open/future/invalid/overlap outcomes, terminal immutability, replay payload/actor
binding, and exactly-once audits. ABA coverage changes a fact, restores exact snapshot
timestamps at a later version, and proves approval remains a durable audit-free stale
result. An injected audit failure proves request, fact, and operation rollback together.
Transaction-scoped owner fixtures exercise invalid states without changing migrations or
weakening application grants.

`apps/web/e2e/manager-corrections.spec.mts` supplies real concurrent network evidence:
eight same-ID approvals across live sessions, competing approve/reject UUIDs, manager
tabs, and mixed employee clock/submission/withdrawal/manager calls. A local PostgreSQL
session holds the employee advisory lock while manager authorization expires; the
blocked decision is observed in `pg_stat_activity`, then denied after release with no
fact or resolution. Browser checks cover final employee status/explanation, applied
facts, escaping, focus/error/status semantics, duplicate-submit controls, and 320px.

`manager_time_exports.test.sql` covers export table/column/index/constraint contracts,
owners, search paths, grants, RLS, private helper denial, immutable row/operation
guards, and independent preview/creation/history/download authorization. Invented
fixtures test Brussels midnight, adjacent dates, overnight shifts, spring-forward and
autumn-repeat offsets, microseconds, missing optional identity fields, pending/open
blockers, approved adjustments and missed entries, rejected/withdrawn proposals, exact
retry and changed actor/payload denial. Stored snapshots survive
source/profile/code/worksite/membership changes. Tests recompute the canonical hash,
inspect safe creation audits, inject snapshot/audit failures, and enforce 10,000 rows
and conservative 10 MiB bounds.

`apps/web/e2e/manager-exports.spec.mts` supplies real creation-retry,
correction-decision, clock-stop, and authorization-after-lock-wait races. Desktop and
exact 320px journeys exercise preview, factual versions, dialog focus, confirmation,
CSV/JSON browser downloads and byte reconciliation, malicious textual cells, history
reload, and copied UUID denial for employee/other-tenant/expired callers. Additional
mobile coverage checks pending-correction errors, focus, navigation, and overflow.
Downloads remain in memory except browser-managed transient downloads, deleted
immediately by tests; no generated export files or credentials are written to tracked
files.

## Phase 7 coverage

`employee_live_breaks.test.sql` adds synthetic transactional coverage for live
start/end, clock-out refusal, retry/actor/intent binding, tenant reads, direct-write
denial, immutable history, microseconds, authorization states, fact/audit rollback,
correction containment and durable conflict outcomes, and zero-output v1 export
blockers.

`employee-live-breaks.spec.mts` supplies production-browser journeys at desktop and
exact 320px, simultaneous tabs, eight same-ID starts across two live sessions,
end/clock-out and start/clock-out races, and authorization expiry while waiting on
namespace 17031. It also compares existing v1 CSV/JSON download bytes and artifact
hashes before and after new break-bearing facts cause preview/creation blocking.
Captures are opt-in, synthetic, and saved only under ignored `.impeccable/review/`.

These descriptions identify authored coverage, not executed results. Run the complete
README gate sequence on a working local Docker Linux engine. No hosted fallback, real
employee data, payroll/statutory-rest assumptions, or production-readiness claim
applies.

`break_corrections_export_v2.test.sql` covers all claim kinds, withdrawal, approval,
rejection and durable replay; original/revision/tombstone resolution; stale parent ABA;
containment, overlap and permitted touching; Brussels DST gaps/occurrences; RLS and role
denial; mutation/TRUNCATE guards; approval-audit and snapshot fault rollback; v1
blocking after removal; exact v2 arithmetic, canonical hash, immutable snapshots, row
and byte bounds. Fixtures roll back. Production `break-corrections-v2.spec.mts` adds
separate-session decision, shift-correction, clock/export races and expiry after
advisory waits, plus desktop/320px journeys and authenticated artifact checks.

New browser fixtures explicitly clean their synthetic tenant and Auth accounts. Local
teardown uses connection-scoped trigger bypass to remove circular protected fixture
history; it is never used to authorize or execute application operations. Existing
full-suite fixtures are discarded by local resets as documented in earlier phases.
