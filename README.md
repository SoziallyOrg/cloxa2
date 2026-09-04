# Cloxa

Cloxa is a Dutch-language web application for one Flemish organization with one worksite
and 5–20 employees. This repository contains local invitation-based authentication,
tenant authorization, and manager/employee entry pages. Managers can invite fictional
employees; employees can accept, set passwords, sign in, and recover access. Time
registration lets an active employee start and stop work at the sole pilot worksite and
review today's own registrations. Employees can submit reviewable adjustment and
missed-entry claims without changing factual registrations, then withdraw pending
claims. Managers review their own organization's proposals, approve exact intervals, or
reject with an explanation. Approval updates factual history atomically; employees see
final decisions and manager explanations.

## Manager team administration (Phase 9)

`/manager` links to `/manager/team`: pilot names, bounded roster, invitation status,
employee name/code edits and explicit access confirmations. Open shifts/breaks block
suspension; pending corrections stay stored and reviewable. Reactivation restores same
membership, never a second one. Access relies on active membership, not session logout.

Edits affect future reads/exports only; existing v1/v2 snapshots and CSV/JSON bytes stay
fixed. No Auth manipulation, resend, production mail, role changes, deletion, tenant
switching or second worksite. Conflicting optional invitation codes remain unassigned
for manager review. Local-only delivery boundary remains unchanged.

See [manager RPC/access/lock contract](packages/database/MANAGER_TEAM.md) and
[Phase 9 verification](PHASE_9_STATUS.md). Focused production journey:

```powershell
$env:CLOXA_E2E_PRODUCTION = '1'
pnpm exec playwright test apps/web/e2e/manager-team.spec.mts
```

## Workspace

```text
apps/web             Next.js App Router application
packages/domain      Framework-independent business rules (empty boundary)
packages/database    Generated Supabase database types
supabase/migrations  Versioned local database migrations
supabase/tests       Transactional pgTAP authorization tests
```

## Requirements

- Node.js 24 or newer
- pnpm 11 or newer
- Docker Desktop or another Docker-compatible runtime for local Supabase

All application and test dependencies are open source. Local development does not
require a paid service.

## Install

```bash
pnpm install
```

Complete local setup below before using authentication or running E2E tests.

## Local Supabase

No hosted project is linked. Commands below operate on local Docker containers only.

1. Start local services:

   ```bash
   pnpm supabase:start
   ```

2. Inspect local URLs and keys on your own machine:

   ```bash
   pnpm supabase:env
   ```

   Output contains privileged local keys. Do not paste it into logs, tickets, or chat.

3. Create ignored `apps/web/.env.local` with these three values from local status:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=<API_URL>
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<ANON_KEY_OR_PUBLISHABLE_KEY>
   SUPABASE_SECRET_KEY=<SERVICE_ROLE_KEY_OR_SECRET_KEY>
   ```

   Map local `SERVICE_ROLE_KEY` or `SECRET_KEY` to `SUPABASE_SECRET_KEY`. This
   credential bypasses RLS and must stay server-only. Never prefix it with
   `NEXT_PUBLIC_`, import its environment module into client code, or commit
   `.env.local`. `.env.example` lists supported names; do not leave empty fixture lines
   if using the helper below.

4. Generate missing fictional local credentials, then create manager fixtures:

   ```bash
   pnpm local:credentials --confirm-local-development
   pnpm local:bootstrap --confirm-local-development
   ```

   Both commands require this explicit flag. Credential generation checks Git ignore
   status and matches configured URL/keys against this repository's running local stack.
   It preserves existing values and appends missing settings without printing them:

   - `CLOXA_SITE_URL`, default `http://localhost:3000`
   - `CLOXA_LOCAL_MANAGER_EMAIL`, default `manager.local@example.test`
   - `CLOXA_LOCAL_MANAGER_PASSWORD`
   - `CLOXA_LOCAL_EMPLOYEE_PASSWORD`
   - `CLOXA_LOCAL_EMPLOYEE_RESET_PASSWORD`

   Empty existing values, duplicate names, hosted URLs, and mismatched local keys cause
   refusal. Bootstrap uses a literal loopback endpoint and rejects HTTP redirects. It
   creates one confirmed fictional manager, profile, research-pilot organization,
   `Europe/Brussels` worksite, and active manager membership. Repeated bootstrap runs
   preserve passwords and fixtures; conflicting records cause refusal instead of an
   overwrite. See [scripts/README.md](scripts/README.md).

5. Run `pnpm dev`, then open [local Cloxa](http://localhost:3000/login). Read manager
   credentials from your ignored file; do not share them. Open
   [local Mailpit](http://127.0.0.1:54324) for invitation and recovery messages. Local
   SMTP captures mail without sending it to external recipients. Use `example.test`
   addresses and fictional names only.

6. Stop local containers without deleting their volumes:

   ```bash
   pnpm supabase:stop
   ```

Useful local commands:

```bash
pnpm supabase:status
pnpm supabase:reset
pnpm test:db
pnpm supabase:lint
pnpm supabase:types
pnpm supabase:types:check
```

Create every migration through the CLI before editing its generated SQL file:

```bash
pnpm exec supabase migration new <descriptive_name>
pnpm exec supabase migration list --local
```

`pnpm supabase:reset` rebuilds the local database from versioned migrations.
`pnpm test:db` runs the pgTAP files in `supabase/tests`. `pnpm supabase:lint` checks the
`public` and `private` schemas and fails on warnings. After a successful reset, run
`pnpm supabase:types` to regenerate and format the public TypeScript database types.
`pnpm supabase:types:check` regenerates them in memory and fails when the stored file is
missing or stale.

Global `auth.enable_signup = false` rejects public signup.
`auth.email.enable_signup = true` keeps the email/password provider available for
administrator invitations, login, and recovery; it does not override the global signup
block. Supabase documents the separate signup and email-provider switches in its
[Auth configuration reference](https://github.com/supabase/auth/blob/master/_autodocs/configuration.md).
The app exposes no signup action. Local configuration does not change hosted settings.

## Authentication flow

`/login`, `/forgot-password`, `/reset-password`, and `/accept-invitation` use server
actions. The callback verifies Supabase email tokens server-side and redirects to fixed
local routes. Auth clients store tokens in `HttpOnly`, `SameSite=Lax` cookies; HTTPS
also sets `Secure`. Local HTTP is permitted on loopback only. Browser-importable code
has no service credential. Proxy refresh preserves response cookies and cache headers;
server pages and actions enforce current database authorization.

Managers submit employee email, optional display name, and optional employee code. The
database derives organization and `employee` role from trusted membership state,
normalizes email, and blocks duplicate usable invitations or active memberships.
Invitation creation returns the same Dutch success response for duplicate/no-op cases;
password recovery conceals whether an account exists.

Application invitations expire after 24 hours. Supabase invite/recovery links expire
after 1 hour. A verified callback sets a signed, user/session-bound, purpose-specific
cookie valid for 15 minutes; acceptance and password reset require that proof. The
acceptance transaction creates or completes profile and employee membership, marks the
invitation accepted, and appends one minimal audit event. Replays cannot create another
membership. Password reset also signs out other Auth sessions.

Supabase Auth email delivery and password updates cannot share the application database
transaction. A delivery failure triggers a conditional revocation attempt; acceptance
failure after password creation can leave an Auth account without tenant access. The
database still commits profile, membership, invitation, and acceptance audit together.
Supabase administrator invitations reject already-confirmed Auth accounts; this phase
does not add a reinvitation flow for those accounts. Use a new fictional employee email
for a fresh local journey, or reset the local stack if its test data is disposable.

## Authorization model

`public.memberships` is the authoritative source for tenant membership and application
roles. Policies derive the current identity from `auth.uid()` and do not trust user
metadata, route names, browser state, or email addresses as proof of authorization.
Authenticated users can read their own profile and update its `display_name` and
`locale`. Active employees can read their active membership, organization, and worksite
but cannot list coworkers. Active managers can read memberships, member profiles,
invitations, and audit events inside their own organization. Browser roles cannot
directly manage organizations, worksites, memberships, invitations, or audit events.
Employees receive read-only access to their own permitted `time_entries`; verified
active managers receive read access inside their sole active organization. Employees
likewise receive read-only access to their own `correction_requests`; all correction
writes pass through controlled authenticated RPCs.

Invited and inactive memberships grant no organization-scoped access. Suspension removes
access to organization-scoped rows, including users' own memberships; users retain
access to their own profile. Audit events are append-only. Controlled invitation
functions own invitation creation, membership activation, and minimal audit insertion.
Clock RPCs likewise require a verified, non-deleted, non-banned Auth user with a live
matching `auth.sessions` row, exactly one active employee membership, an active
organization, and exactly one database worksite.

The app supports one active membership per user. Multiple active memberships return an
unsupported state, including a second membership in a suspended organization; the app
does not choose a tenant. Anonymous requests redirect to `/login`; authenticated users
without a supported active role reach `/unauthorized`. See the access matrix and RPC
contracts in [packages/database/README.md](packages/database/README.md).

Secret-key and service-role clients can bypass row-level security. They must remain
server-only and be limited to controlled operations; never import one into browser code.

## Employee time clock

`/employee` renders a Dutch mobile-first clock screen through a Server Component and
Server Action. Browser submissions contain only an operation intent and a generated UUID
request ID. Database RPCs derive employee membership, organization, sole worksite, and
timestamps from trusted locked state. Stored timestamps are `timestamptz`; display uses
`nl-BE` and `Europe/Brussels` while durations use absolute instants.

A partial unique index enforces at most one open entry per membership. Both clock RPCs
take the same advisory and row locks in a fixed order. A private request ledger
preserves the first outcome for each request UUID, so retries return the same result.
Different rapid requests return `already_working` or `already_stopped` without
duplicating entries or audits. Each real start or stop appends exactly one minimal audit
event in the same transaction; retries and no-ops append none.

Time entries cannot be inserted, updated, or deleted directly by browser roles. Active
employees may select only entries belonging to their own active employee membership and
active organization. Anonymous, inactive, unaffiliated, expired-session,
ambiguous-tenant, suspended-organization, and cross-tenant access fails closed.

## Employee correction requests

`/employee/corrections` lists up to 20 recent closed own registrations and 50 own
correction requests. Employees can propose a changed start and/or end for a closed own
entry, report a completely missed closed interval, or withdraw an own pending request.
Submission and withdrawal leave `time_entries` untouched. Manager approval is the
separate controlled operation that may apply the proposal.

Inputs use Dutch `dd/mm/jjjj uu:mm` wall-clock text and one explicit conversion path in
Postgres for `Europe/Brussels`. Nonexistent spring-forward values fail. Repeated autumn
values require an explicit first or second occurrence. Accepted instants are stored as
`timestamptz`. Prefilled values preserve seconds and microseconds; optional `:ss.ffffff`
precision stays intact through conversion. Database checks require a bounded trimmed
reason, strict chronology, entirely past intervals, a real change for adjustments, and
no overlap with other factual entries or pending employee proposals.

Submission and withdrawal functions reuse the time clock's per-user advisory lock and
lock order. A private immutable operation ledger binds each request UUID to operation
and payload hash. Identical retries replay the original outcome; altered payloads fail
closed. Real submissions and withdrawals append one status-only audit each, while
retries and no-ops append none. Browser roles cannot insert, update, or delete
correction rows.

## Manager correction review

`/manager/corrections` shows all pending requests and the 50 latest terminal requests
from the manager's own organization. Expand a row to compare original facts with the
employee proposal, including exact timestamp precision and Brussels UTC offset. Approval
requires confirmation; rejection requires a trimmed explanation of at most 500
characters. Optional approval notes share that bound. Both remain escaped text.

The browser submits only an operation UUID, correction UUID, decision, and note. Private
database code locks the employee using the clock/correction advisory-lock namespace,
rechecks manager authorization after waits, then locks factual and request rows.
Approval revalidates original timestamps and the immutable factual-version snapshot,
plus employee membership, sole worksite, closed/past interval, and current factual
overlaps. A fact that changed and later returned to the same timestamps is still stale.
Stale or overlapping proposals remain pending without factual changes or decision
audits. Reject them with an explanation so the employee can submit a new proposal.

One transaction applies the exact proposal, resolves the request, records an immutable
operation outcome, and appends audits. Rejection appends only its status audit. Approval
also appends exact old/new factual timestamps, versions, origins, and correction
reference. Employee reasons and manager notes never enter audit payloads. Replaying an
operation UUID with identical content returns its original outcome; changed content
fails. Competing decisions produce one terminal transition. Terminal claims and decision
ledgers cannot be updated, deleted, or truncated by application roles.

Employee correction history shows final status and explanation. Factual readers show
approved adjustments and newly approved missed entries. Browser reads exclude manager
membership and decision-operation identifiers. Historical claims remain stored beyond
the UI's limits; full correction-history pagination is not implemented.

## Manager-confirmed time exports

`/manager/exports` lets an active same-tenant manager select one inclusive Brussels
calendar period of 1–31 days, preview current rows/versions/counts/warnings/blockers,
explicitly confirm a fixed snapshot, download deterministic CSV or JSON, and inspect 20
recent manifests. Preview is advisory: confirmation reruns selection and authorization
inside the database while holding locks. Confirmation approves only captured factual
versions for that export. It does not add a mutable approval flag to `time_entries`.

Selection uses `[local start 00:00, day after local end 00:00)` converted through
`Europe/Brussels`. A finite, closed, strictly ordered factual entry is assigned by its
Brussels-local start date; its complete elapsed interval remains in that one period,
including overnight work. Clock-origin, manager-adjusted, and approved missed-entry
facts are eligible. Empty selections, future/invalid/over-31-day periods, more than
10,000 rows, an overlapping open entry, a pending correction targeting a selected fact,
an overlapping pending adjustment/missed-entry proposal, or a conservative 10 MiB
artifact estimate block creation. Missing display names/codes stay null/empty and yield
warnings.

Migration `20260903141934_approved_time_exports.sql` adds tenant-owned read-only
`public.time_exports`, private fixed `time_export_rows`, and private creation-operation
outcomes. Creation takes a global operation UUID lock, then every existing tenant
employee's `17031` clock/correction advisory lock in stable hash/UUID order, then
membership, organization, worksite, factual, and correction row locks. Authorization is
checked again after waits. One statement snapshot reads facts, names, codes, totals, and
blockers consistently. Snapshot rows, manifest, dataset hash, exactly one
`time_export.created` audit, and successful idempotency outcome commit together. A
failure in snapshot or audit insertion rolls everything back. Identical operation UUID
and raw payload retries return the original result; altered actor/period/confirmation
reuse fails closed. Different UUIDs intentionally create separate history snapshots.

Schema `cloxa.time-export.v1` manifest fields are `schema_version`, `export_id`,
`organization_id`, `worksite_id`, `timezone`, inclusive
`period_start_local`/`period_end_local`, database-controlled `created_at_utc`,
`record_count`, `employee_count`, exact decimal-string `total_duration_microseconds`,
`dataset_sha256`, and `selection_rule` (`brussels-start-date.v1`). Each ordered row
stores `row_ordinal`, source entry ID and version, nullable employee code/name, worksite
ID/name, UTC start/end with six fractional digits and `Z`, Brussels start/end with six
fractional digits and explicit offset, decimal-string elapsed microseconds, factual
origin, and nullable last correction reference. Ordinals derive from membership ID, UTC
timestamps, and entry ID.

Dataset SHA-256 hashes UTF-8 PostgreSQL `jsonb` text containing manifest inputs without
`dataset_sha256` plus ordered row objects. JSON emits one `{manifest, records}` object
with stable property order, explicit nulls, LF, and no BOM. CSV repeats manifest fields
on each record, quotes every field, doubles quotes, uses UTF-8 BOM and CRLF. In employee
code/name/worksite text, leading Unicode whitespace, control/format characters, or `=`,
`+`, `-`, or `@` gets a deterministic leading apostrophe before CSV quoting. Commas,
semicolons, quotes, CR/LF, accents, and remaining text are retained.

Downloads use current Supabase session through a server Route Handler. Each request
reauthorizes verified/non-banned/non-deleted Auth state, matching live session, exactly
one active manager membership, active pilot/beta tenant, sole worksite, and tenant-owned
export. Responses use ASCII-only filenames, accurate content type, attachment,
private/no-store caching, `nosniff`, and an artifact SHA-256 header. No public/signed
URL, service-role secret, Storage object, application log, or persistent temporary
export is used. Only creation is audited; no download event is recorded. Retention and
controlled deletion remain future work. Field definitions and canonical byte rules live
in [export v1 contract](packages/database/TIME_EXPORT_V1.md).

## Live unpaid breaks

Employees can start and end a live unpaid break on their currently open shift. Each
operation accepts only a client UUID; ownership and timestamps come from locked server
state. Clock-out refuses an open break and never closes it automatically. Dutch clock
screens show working/break state, ordered intervals, and exact gross, completed-break,
and net durations. Open intervals stay labelled open. Europe/Brussels display retains
UTC timestamps and all six fractional digits; no timer writes to the database.

Adjustment submission and manager approval inspect locked break facts. Proposals must
contain every completed break. `break_conflict` is durable on retry; a failed approval
keeps the request pending without approval/factual audits. Correction context shows
break intervals but offers no break-editing fields.

New `cloxa.time-export.v1` previews and creations block any selected fact with breaks
using `break_data_requires_v2`. Blocked creation stores only its private retry outcome:
no export metadata, snapshot rows, audit, or artifact. Existing snapshots and their
CSV/JSON bytes and hashes are unchanged. Phase 8 adds break-aware v2 as a separate
schema and workflow below.

Breaks are factual unpaid intervals, not statutory-rest or payroll calculations. Live
start/end remains server-owned. Historical changes use the separately reviewed request
and revision workflow described below; automatic breaks and statutory-rest rules remain
unimplemented. No compliance or production readiness claim is made.

## Verification

Run this sequence in order against the local stack. These commands describe the
verification procedure, not a claim that a particular checkout has passed:

```bash
pnpm supabase:reset
pnpm test:db
pnpm supabase:lint
pnpm supabase:types
pnpm supabase:types:check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
CLOXA_E2E_PRODUCTION=1 pnpm test:e2e
pnpm audit --prod --audit-level high
git diff --check
pnpm test:bundles
```

`supabase:reset` deletes local database contents and recreates the schema. Bootstrap
again after reset for manual use. Playwright bootstraps its manager through the same
explicitly flagged local helper, then uses a fresh fictional employee and local Mailpit.
Its desktop Auth journey covers invitation, acceptance, logout/login, and password
recovery/reset. Separate desktop and 320px mobile clock journeys cover start, duplicate
submission, concurrent tabs, stop, and persisted state after reload. Correction journeys
cover adjustment and missed-entry submission, duplicate submission, reload persistence,
escaped reason rendering, withdrawal, audit counts, unchanged factual entries, focus and
field-error semantics, and exact 320px layout. Separate parallel-RPC tests use two live
employee sessions for identical retries, conflicting pending intervals, withdrawal
races, and mixed clock/correction calls. Manager journeys cover approval/rejection
persistence, employee outcomes and facts, concurrent manager tabs, eight-way retries,
mixed clock/correction/decision calls, stale-target handling, generic retry failures,
and session expiry after an advisory lock wait. Export journeys cover desktop and exact
320px preview/confirmation, blocker navigation, fixed CSV/JSON reconciliation, formula
neutralization, retries/history, role/tenant/session denial, correction/clock races, and
authorization expiry after a lock wait. Auth journey traces, screenshots, and videos
stay disabled to avoid retaining credentials or email links.

`pnpm build` checks production browser bundles for server-secret exposure;
`pnpm test:bundles` repeats that check on an existing build. Use `pnpm format` to fix
formatting before verification. Stop on assertion, security, data-loss, or build
failures; investigate a transient tool failure without rerunning the entire sequence.

Playwright requires Chromium once per machine:

```bash
pnpm exec playwright install chromium
```

## Scope boundaries

- Invitation-only; no public signup or automatic billing.
- No ORM, Redux, Redis, queues, realtime, storage, analytics, or microservices.
- No offline mode or service worker. Manifest only.
- No direct manual factual entries, PDF/XLSX, scheduled or emailed export, provider
  delivery, scheduling, billing, realtime updates, or native app.
- No claim that Cloxa calculates payroll, satisfies Belgian employment rules, or is
  production-ready.
- No remote Supabase connection, hosted deployment, or real employee data. Development
  and tests remain local and synthetic.

Exports are factual handoff files only. No social-secretariat mapping or delivery,
payroll calculation, declaration, legal-compliance claim, or acceptance claim exists.

## Historical break corrections and export v2

Employees use `/employee/break-corrections` for missed unpaid breaks, interval
adjustments, removals and pending-request withdrawal on recent closed shifts. Managers
use `/manager/break-corrections` to compare original and current versions, inspect stale
claims and confirm approval or rejection. Dutch Brussels-local inputs preserve six
fractional digits and require explicit fall-back occurrence choices. Approvals append
revisions; removal stops a break counting without erasing its history.

`/manager/exports-v2` previews and confirms `cloxa.time-export.v2` snapshots with exact
gross, unpaid-break and net-worked durations and ordered effective break records. CSV
and JSON downloads reauthorize the current manager and verify the dataset hash. Existing
v1 exports remain available at `/manager/exports`; new v1 exports refuse any selected
entry with live-break or revision history, even after removal.

See [v2 contract](packages/database/TIME_EXPORT_V2.md) for exact schemas, RPCs, result
codes, lock namespaces, canonical bytes, bounds, audit actions and limitations, and
[Phase 8 status](PHASE_8_STATUS.md) for verification results. All work remains local and
synthetic; no merge, deployment or real employee-data use is authorized.
