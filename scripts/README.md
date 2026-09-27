# Local Auth fixtures

Keep the three Supabase URL/key settings in ignored `apps/web/.env.local`, using values
from this repository's running local stack. Never put hosted credentials there.

Generate missing fictional credential settings without displaying their values:

```bash
pnpm local:credentials --confirm-local-development
pnpm local:bootstrap --confirm-local-development
```

Credential generation preserves existing content and values. It refuses non-ignored,
symlinked or nonregular files, duplicate variable names, empty fixture settings, and
keys or URLs that do not match the local stack. Remove blank fixture-variable lines from
a copied `.env.example`, or fill them yourself before running the command. Manager email
uses `example.test`; three independent random passwords stay in the ignored file. No
values are printed.

Bootstrap creates one fictional manager, organization, Brussels worksite and active
manager membership. Reruns neither reset passwords nor overwrite conflicting records.
E2E adds unique fictional employees; no broad account or inbox cleanup runs. Resetting
the local database removes local fixtures when explicitly requested.

## Isolated local Auth E2E

Run `pnpm test:e2e:local-auth` only against this repository's verified local
Docker/Supabase stack. It requires ignored local URL/key settings that match running
stack, `CLOXA_LOCAL_EMPLOYEE_PASSWORD`, `CLOXA_LOCAL_EMPLOYEE_RESET_PASSWORD`, local
Mailpit, and installed Chromium. Docker host/context selection is resolved and pinned
before first status request; remote, conflicting, or ambiguous selectors are refused.

Dedicated journey does not use retained bootstrap manager. Each run creates unique
fictional `example.test` manager and employee identities and an ownership proof, then
creates exact run-owned organization, worksite, profiles, memberships, invitation, MFA
registration, and audit rows. Cleanup locks checked local graph, verifies run/proof,
tenant, identities, timestamps, inviter, and relationships, and deletes only verified
rows and users. It does not reset database, sweep factors, or clean by email/marker.

Uncertain ownership, interrupted invitation, database failure, or Auth deletion failure
preserves remaining resources and reports sanitized resource classes. Complete expected
lease/state is in memory; proof value also persists in server-owned Auth app metadata.
Process loss still has no approved automatic cleanup path. Cleanup replay after full
success returns preserved with empty remainder; replay after employee deletion followed
by manager deletion failure preserves manager. Handle leftovers manually only after
independent exact ownership verification.

Each run bounds its Auth/Data API requests and Docker SQL client. Operation cancellation
stops new fixture mutations. An Auth deletion already dispatched, or SQL whose client
exit cannot be confirmed, remains uncertain; cleanup stops before another deletion.
Killing the owned Docker client does not prove its in-container SQL stopped, so server
transaction deadlines and conservative retained state remain required.

Cleanup uses transaction-local deadlines and table-wide graph locks that briefly block
other local writers. Native success, refusal, rollback, trigger-restoration,
unrelated-fixture preservation, and interleaving probes require explicit approval plus a
quiescent disposable local stack; unique fixture IDs alone do not isolate concurrent
writers. Do not stop another local job to create that condition. Native manager probes
first run both generated observer queries read-only before fixture creation. They do not
replace the dedicated browser journey's full employee-graph cleanup coverage.

## One-time preserved fixture recovery

`scripts/local-auth-preserved-fixture-recovery.mjs` is a fixed, local-only recovery
command for preserved UX fixture run `a3a76fea-4c19-45cd-9fa4-750432f20d94`. It refuses
every other run, organization, manager, employee, or preservation digest. Before any
mutation, it re-establishes shared server-owned fixture proof, exact Auth identities and
factor state, complete discovered foreign-key coverage, exact graph IDs/cardinalities,
and tight creation-time boundary under same locks used by generic fixture cleanup.

Run only after separate source review and explicit native approval:

```bash
pnpm local:preserved-fixture-recovery --confirm-local-development --confirm-run a3a76fea-4c19-45cd-9fa4-750432f20d94 --confirm-organization 6ba3fda2-97f5-4b0b-86a3-4e3f372fd164 --confirm-manager-user e5a5b363-c46a-4bf9-b43c-5165a4776124 --confirm-employee-user a449e191-5d60-47d2-bde9-03dadd04bc49 --confirm-preservation-sha256 88f34aaed7ab9fc190dc5ec781d250ffc4b25487e2b472ba1b4c1af622592947
```

Command first runs read-only catalog and snapshot transactions. Proven graph then uses
`buildLocalAuthCleanupSql` through `cleanupLocalAuthE2eLease`: database cleanup first,
employee Auth deletion second, manager Auth deletion last. Protected temporary evidence
records each confirmed boundary. Ownership proof remains only while resources may remain
and is redacted after complete cleanup. Existing evidence makes command one-time;
ambiguity or mismatch stops with remaining resources preserved. Command does not reset
database, sweep by marker/email, delete factors directly, or handle another fixture.

## Local manager MFA recovery

`scripts/local-manager-mfa-recovery.mjs` supports only `start`, `status`, and `complete`
for configured fictional manager. Every command requires local-development confirmation,
exact target confirmation, fixed repository stack, ignored matching credentials, no
hosted link, and literal loopback API/database endpoints. `status` and `complete` also
require exact case confirmation; `complete` requires exact candidate confirmation.
Docker selection is resolved from `DOCKER_CONTEXT`, `DOCKER_HOST`, or active context
before stack inspection. Conflicting selectors, remote/ambiguous contexts, SSH/TCP, and
remote named pipes are rejected. Valid local Unix socket or Windows named-pipe endpoint
is pinned for Supabase status and every maintenance command without changing Docker
configuration.

```bash
pnpm local:manager-mfa-recovery start --target-user <user-uuid> --operation-id <operation-uuid> --confirm-local-development --confirm-target <same-user-uuid>
pnpm local:manager-mfa-recovery status --target-user <user-uuid> --case-id <case-uuid> --confirm-local-development --confirm-target <same-user-uuid> --confirm-case <same-case-uuid>
pnpm local:manager-mfa-recovery complete --target-user <user-uuid> --case-id <case-uuid> --candidate-id <candidate-uuid> --operation-id <operation-uuid> --confirm-local-development --confirm-target <same-user-uuid> --confirm-case <same-case-uuid> --confirm-candidate <same-candidate-uuid>
```

Generate operation UUIDs outside CLI. Start commits recovery denial, then uses native
Admin API to inspect and delete only registered verified TOTP. Failure remains blocked;
same operation retry inspects actual factor state before resuming. After manager
verifies replacement in browser, use `status` candidate list and manually select exact
candidate. Completion updates binding and minimal audit atomically. It does not promote
candidate session; manager must log in again and verify replacement factor.

Expiry after replacement verification can leave verified candidate in native Auth while
application binding still names old factor. Normal restart then refuses retained factor
as unrelated, deletes nothing, and leaves access denied. Separately authorized operator
handling outside this fixed CLI is required. Do not claim or rely on automatic native
expire → restart → completion behavior.

CLI output contains only case state, deadline, binding generation, and non-secret case
or candidate references. It never prints factor/session IDs, passwords, keys, tokens,
OTPs, or enrollment secrets. Stop on unexpected provider factor state. Workflow is local
development only; production identity proofing and hosted support recovery do not exist.

## CI environment preparation

`scripts/ci-local-env.mjs` is a GitHub-Actions-only bridge for a disposable runner. It
captures structured `supabase status --output json` without printing CLI output, checks
repository project ID and local API/database ports, rejects hosted or malformed URLs,
and accepts current or legacy local CLI key names. It creates only ignored
`apps/web/.env.local`, refuses an existing target, and applies mode `0600` on Linux.

Generated identities use `example.test`; three random passwords are independent. Keys
and passwords are registered with GitHub log masking before tests. Normal messages and
sanitized failures contain no values, status dumps, or command stderr. Supabase CLI
nonzero status is preserved. Workflow cleanup removes environment file and stops only
local project `cloxa2` with no backup, including after failed gates. Do not run helper
as a replacement for local credential setup; it refuses execution outside GitHub
Actions.

Playwright runs on `127.0.0.1:3100`, retrieves invitation and recovery mail from local
Mailpit, and disables traces, screenshots, video and retained test artifacts. Build
automatically scans production browser bundles for server-secret leakage. Pinned
Playwright's automatic failure DOM snapshots are disabled too, keeping form values out
of error reports. Browser requests allow only the local app and Auth API.

Correction journeys use fresh synthetic employees and authenticated RPCs for factual
clock records and correction mutations. Parallel tests use two independent live sessions
to exercise retry, overlap, and withdrawal races. Service credentials create fixtures
and inspect outcomes only; they never write factual time or correction rows.

Manager review journeys create separate synthetic organizations, managers, and employees
per test. Normal clock, claim, and decision changes use authenticated RPCs. Local Docker
owner SQL creates defensive timestamp-drift and session-expiry fixtures and holds an
employee advisory lock for a measured wait test; it never substitutes for manager RPC
authorization. No hosted database URL or remote SQL client is accepted by these helpers.
Each real application appends one status audit and one factual audit, while rejection
appends only a status audit. Audit checks exclude employee reasons and manager notes.

Run manager journeys against the production build from PowerShell:

```powershell
pnpm build
$env:CLOXA_E2E_PRODUCTION = '1'
pnpm exec playwright test apps/web/e2e/manager-corrections.spec.mts
```

For stale or overlapping requests, approval leaves the request pending. Reject with a
clear explanation, then ask the employee to submit a new proposal. Do not edit pending
claims, reset operation ledgers, or update factual records through direct SQL as an
operational workaround. Identical decision UUID retries return the stored result;
changes to note, request, intent, or manager require a new operation UUID. The UI keeps
the UUID while retrying an unchanged payload after a generic transport failure.

Manager queue includes every pending request and 50 recent terminal requests. Employee
history retains its 50-request/20-closed-entry reader limits. Older records and
immutable audit evidence stay stored. Manager-confirmed time exports have their own
bounded 31-day selection and 20-export history; full-history pagination remains absent.

For local UI review only, `CLOXA_CAPTURE_REVIEW=1` captures the correction page after
its synthetic journey into ignored `.impeccable/review/desktop.png` and `mobile.png`.
These captures exclude Auth forms, passwords, cookies, and links. Normal E2E runs keep
capture disabled; review images never enter Git.

The manager journey uses the same opt-in capture variable and saves manager queue and
approval-dialog screenshots at desktop and exact 320px widths. Review fixtures contain
escaped HTML-like text deliberately; no scripts execute and no real identities appear.

`apps/web/e2e/manager-exports.spec.mts` uses the same local-only fixture infrastructure.
Normal sessions create and download exports. CSV/JSON bytes are reconciled in memory;
browser-managed transient downloads are deleted immediately, never saved as artifacts.
Database-owner helpers only inspect synthetic audit/ledger outcomes or hold local locks
and expire synthetic sessions for race tests. Opt-in review captures show export preview
and confirmation at desktop and exact 320px. No new environment variables or hosted
resources are required. Run the complete production suite with
`CLOXA_E2E_PRODUCTION=1 pnpm test:e2e` (PowerShell: set `$env:CLOXA_E2E_PRODUCTION='1'`
before `pnpm test:e2e`). Keep capture opt-in unset during normal verification.
