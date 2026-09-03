# Database tests

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
cover implemented database behavior; exports remain outside scope.

`manager_correction_review.test.sql` checks exact private-ledger columns, indexes,
constraints, owner/search paths/grants, safe browser column reads, and tenant-consistent
foreign keys. It exercises manager and employee read boundaries, all unsupported caller
states, service-role impersonation, exact microsecond application, missed-entry origin,
version increments, rejection without factual change, stale/open/future/invalid/overlap
outcomes, terminal immutability, replay payload/actor binding, and exactly-once audits.
An injected audit failure proves request, fact, and operation rollback together.
Transaction-scoped owner fixtures exercise invalid states without changing migrations or
weakening application grants.

`apps/web/e2e/manager-corrections.spec.mts` supplies real concurrent network evidence:
eight same-ID approvals across live sessions, competing approve/reject UUIDs, manager
tabs, and mixed employee clock/submission/withdrawal/manager calls. A local PostgreSQL
session holds the employee advisory lock while manager authorization expires; the
blocked decision is observed in `pg_stat_activity`, then denied after release with no
fact or resolution. Browser checks cover final employee status/explanation, applied
facts, escaping, focus/error/status semantics, duplicate-submit controls, and 320px.
