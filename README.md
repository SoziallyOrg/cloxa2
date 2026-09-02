# Cloxa

Cloxa is a Dutch-language web application for one Flemish organization with one worksite
and 5–20 employees. This repository contains route shells, tooling, Supabase client
boundaries, and the local tenant-authorization database foundation. It does not yet
contain authentication forms, invitation acceptance, or a working time-registration
workflow.

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

## Install and run web app

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`. Public pages do not require Supabase to render. Protected
route shells require a valid local Auth session and therefore redirect anonymous
visitors to `/login`.

## Local Supabase

No hosted project is linked. Commands below operate on local Docker containers only.

1. Start local services:

   ```bash
   pnpm supabase:start
   ```

2. Print local URLs and keys:

   ```bash
   pnpm supabase:env
   ```

3. Copy `.env.example` to `apps/web/.env.local`, then map local values:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=<API_URL>
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<ANON_KEY_OR_PUBLISHABLE_KEY>
   SUPABASE_SECRET_KEY=<SERVICE_ROLE_KEY_OR_SECRET_KEY>
   ```

   For local CLI output, map its `SERVICE_ROLE_KEY` value to `SUPABASE_SECRET_KEY`.
   Hosted projects should use a current `sb_secret_...` key. Both have service-role
   privileges and stay server-only. Never prefix this variable with `NEXT_PUBLIC_`,
   import its environment module into client code, or commit `.env.local`.

4. Run web app with `pnpm dev`.

5. Stop local containers without deleting their volumes:

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

Public signup is disabled globally and for email in `supabase/config.toml`; the app also
exposes no signup action. Before any future hosted deployment, disable “Allow new users
to sign up” in hosted Supabase Auth settings too. Local config does not change hosted
settings.

## Authorization model

`public.memberships` is the authoritative source for tenant membership and application
roles. Policies derive the current identity from `auth.uid()` and do not trust user
metadata, route names, browser state, or email addresses as proof of authorization.
Authenticated users can read their own profile and update its `display_name` and
`locale`. Active employees can read their active membership, organization, and worksite
but cannot list coworkers. Active managers can read memberships, member profiles,
invitations, and audit events inside their own organization. Browser roles cannot
directly manage organizations, worksites, memberships, invitations, or audit events.

Invited and inactive memberships grant no organization-scoped access. Suspension removes
access to organization-scoped rows, including users' own memberships; users retain
access to their own profile. Audit events are append-only. Later trusted database
functions will own sensitive writes and audit insertion. See the complete access matrix
and schema decisions in [packages/database/README.md](packages/database/README.md).

Secret-key and service-role clients can bypass row-level security. They must remain
server-only and be limited to controlled operations; never import one into browser code.

## Quality commands

```bash
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

Playwright requires Chromium once per machine:

```bash
pnpm exec playwright install chromium
```

## Scope boundaries

- Invitation-only; no public signup or automatic billing.
- No ORM, Redux, Redis, queues, realtime, storage, analytics, or microservices.
- No offline mode or service worker. Manifest only.
- No claim that Cloxa calculates payroll, satisfies Belgian employment rules, or is
  production-ready.
- No remote Supabase connection, hosted deployment, or real employee data. Development
  and tests remain local and synthetic.

Next task: invitation-based authentication and controlled local test-user creation.
