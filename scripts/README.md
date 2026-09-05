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

## Local manager MFA recovery

`scripts/local-manager-mfa-recovery.mjs` supports only `start`, `status`, and `complete`
for configured fictional manager. Every command requires local-development confirmation,
exact target confirmation, fixed repository stack, ignored matching credentials, no
hosted link, and literal loopback API/database endpoints. `status` and `complete` also
require exact case confirmation; `complete` requires exact candidate confirmation.

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
