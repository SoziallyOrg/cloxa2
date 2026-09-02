# Cloxa

Cloxa is a greenfield, Dutch-language web application for one Flemish organization with
one worksite and 5–20 employees. This repository currently contains technical foundation
only: route shells, tooling, Supabase client boundaries, and local configuration. It
contains no database schema and no working time-registration workflow.

## Workspace

```text
apps/web             Next.js App Router application
packages/domain      Framework-independent business rules (empty boundary)
packages/database    Generated database types/helpers (empty boundary)
supabase/migrations  Database migrations (none yet)
supabase/tests       pgTAP tests (none yet)
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
```

Database reset and pgTAP commands become meaningful after next schema task. Public
signup is disabled globally and for email in `supabase/config.toml`; app also exposes no
signup action. Before any future hosted deployment, disable “Allow new users to sign up”
in hosted Supabase Auth settings too. Local config does not change hosted settings.

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
- No remote Supabase connection, deployment, or real employee data in this foundation.

Next task: define Supabase schema and row-level security policies, then add pgTAP tests
for tenant isolation and role permissions.
