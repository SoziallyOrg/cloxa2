# 001. Greenfield rewrite

## Status

Accepted.

## Context

Codex v1 accumulated ad-hoc test-fixture and recovery machinery that made the codebase
hard to reason about, and its RLS/RPC boundaries were not consistently applied. Rather
than untangle that incrementally, we start from a clean, minimal foundation and re-port
features deliberately.

## Decision

- v1 is frozen at git tag `codex-v1-final` (branch `archive/codex-v1`) and used only as
  reference (`git show codex-v1-final:<path>`).
- Rebuild on `rewrite/*` branches: pnpm workspaces + Turborepo monorepo, Next.js 16 App
  Router, Supabase (Postgres + RLS + `private.*` RPCs), Tailwind 4, zod at every
  boundary.
- No product features land until the foundation (build, lint, test, security headers,
  i18n, design tokens) is green.

## Consequences

Short-term slower start; long-term, a smaller surface to keep correct for the security
invariants in `CLAUDE.md` (tenant isolation, hash-chained audit log, AAL2 for managers).
