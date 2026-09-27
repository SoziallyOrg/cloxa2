# Cloxa

Belgian working-time registration for SMEs and larger organisations (multi-org,
multi-site). Factual clock-in/out registration only — Cloxa never calculates wages,
overtime, rest periods or legal outcomes.

Greenfield rewrite in progress. See `CLAUDE.md` for the working guide and `docs/` for
architecture, security and legal notes.

## Prerequisites

- Node.js >=24
- pnpm 11.25.0 (`corepack enable` or install directly)
- Supabase CLI 2.116.0 (bundled as a dev dependency; run via `pnpm db:*`)
- Docker, for local Supabase

## Setup

```sh
pnpm install
cp apps/web/.env.example apps/web/.env.local   # fill in local Supabase values
pnpm db:start
pnpm dev
```

## Common commands

```sh
pnpm typecheck
pnpm lint
pnpm format
pnpm test
pnpm build
```

## Learn more

- `CLAUDE.md` — working guide, security invariants, code style
- `docs/decisions/` — architecture decision records
- `docs/legal-notes.md` — sourced legal facts (nothing outside this file is
  authoritative)
