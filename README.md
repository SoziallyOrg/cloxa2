# Cloxa

Cloxa is a Dutch-language web application for one Flemish organization with one worksite
and 5–20 employees. This repository contains local invitation-based authentication,
tenant authorization, and manager/employee entry pages. Managers can invite fictional
employees; employees can accept, set passwords, sign in, and recover access. Time
registration lets an active employee start and stop work at the sole pilot worksite and
review today's own registrations.

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
Employees receive read-only access to their own permitted `time_entries`; managers do
not receive time-entry review access in this phase.

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
active organization. Anonymous, manager, inactive, unaffiliated, expired-session,
ambiguous-tenant, suspended-organization, and cross-tenant access fails closed.

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
pnpm test:e2e
pnpm audit --prod --audit-level high
```

`supabase:reset` deletes local database contents and recreates the schema. Bootstrap
again after reset for manual use. Playwright bootstraps its manager through the same
explicitly flagged local helper, then uses a fresh fictional employee and local Mailpit.
Its desktop Auth journey covers invitation, acceptance, logout/login, and password
recovery/reset. Separate desktop and 320px mobile clock journeys cover start, duplicate
submission, concurrent tabs, stop, and persisted state after reload. Auth journey
traces, screenshots, and videos stay disabled to avoid retaining credentials or email
links.

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
- No breaks, manual entries, corrections, approvals, exports, scheduling, billing,
  realtime updates, or native app.
- No claim that Cloxa calculates payroll, satisfies Belgian employment rules, or is
  production-ready.
- No remote Supabase connection, hosted deployment, or real employee data. Development
  and tests remain local and synthetic.

Next task: employee correction requests and manager review.
