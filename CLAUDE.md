# Cloxa — Claude working guide

Keep this file short: it is loaded into every session. Details live in `docs/`.

## Product
- Belgian working-time registration for SMEs → larger orgs (multi-org, multi-site).
- **Factual registration only.** Never calculate wages, overtime, rest or legal outcomes.
- UI never claims "compliant", "wettelijk in orde", "payroll-ready" or "onveranderbaar".
- Users include seniors and non-tech-savvy staff: one obvious action per screen, big targets, plain Dutch (B1).
- Copy: nl-BE only for now, always via `packages/i18n` (no string literals in UI).
- Time: store UTC, display Europe/Brussels, handle DST explicitly.
- Legal facts: `docs/legal-notes.md`. Don't state legal rules that aren't sourced there.

## Status
Greenfield rewrite in progress on `rewrite/*` branches. The Codex v1 app is frozen at tag
`codex-v1-final` (branch `archive/codex-v1`). Use it as **reference only**:
`git show codex-v1-final:<path>`. Don't restore its test-fixture/recovery machinery.

## Map (target)
- `apps/web`: Next.js 16 App Router. `/app` employee PWA, `/kiosk` shared tablet, `/manage` managers/admins.
- `apps/mobile`: Expo (later).
- `packages/domain`: pure TS rules (shift state from events, breaks, DST, corrections). No I/O.
- `packages/db`: generated Supabase types, typed RPC wrappers, zod inputs.
- `packages/i18n`: typed nl-BE catalog (ICU).
- `packages/ui-tokens`: shared design tokens.
- `packages/modules/*`: optional modules (student, flexi, interim, horeca, bouw, remote).
- `supabase/`: migrations, pgTAP tests (`supabase/tests`), email templates.
- `docs/`: `architecture.md`, `security.md`, `design.md`, `legal-notes.md`, `decisions/NNN-*.md`.

## Commands
- `pnpm dev` · `pnpm typecheck` · `pnpm lint` · `pnpm format`
- `pnpm vitest run <file-or-dir>`: **always targeted**, never the whole suite by reflex.
- `pnpm db:test` (pgTAP) · `pnpm db:types` (regenerate types after migrations)
- E2E (Playwright) only when the task touches a user journey, and only the relevant spec.

## How to work (token budget matters)
The main session is the **orchestrator**: plan, write task specs, review diffs, decide.
Delegate the rest:

| Work | Agent |
|---|---|
| Search/understand >3 files | `Explore` |
| Well-specified feature | `implementer` |
| Auth, RLS, migrations, hash chain, offline sync, concurrency | `deep-implementer` |
| Renames, copy, lint/type fixes, boilerplate | `quick-edit` |
| Tests, typecheck, lint, build | `test-runner` (report failures only) |
| Commits/branches | `git-ops` |
| Stuck or high-stakes design | `fable-architect` (sparingly) |

Every task spec contains: **goal · files to touch · what to reuse · acceptance tests · do-not list.**
Run independent tasks in parallel (`isolation: "worktree"` when they touch overlapping areas).

Rules:
- Don't read whole large files or docs. Grep, then read the section.
- Look up library APIs with context7. Next 16, Tailwind 4, Supabase and Expo change often.
- Run `/security-review` on any change to `supabase/migrations`, auth, headers, sessions or exports.
- **No** phase reports, evidence ZIPs, handoff essays or verification ceremonies.
  The record is commit messages, PR descriptions and ADRs of 20 lines or fewer in `docs/decisions/`.
- Tests prove behaviour. Don't write tests about tests or fixture-cleanup harnesses.
  Local DB state is disposable (`supabase db reset`).
- Stop and ask before anything hosted, paid, destructive, or involving real personal data.

## Security invariants (non-negotiable)
- RLS on every table, scoped by `organization_id`. Every new table gets a pgTAP cross-tenant denial test.
- Clients read through RLS. **Writes only via `private.*` SECURITY DEFINER RPCs** with `set search_path = ''`.
  Identity comes from `auth.uid()` + membership rows, never from client input or user metadata.
- `clock_events` and `audit_log` are append-only and hash-chained. Corrections **append**, never overwrite.
- Authoritative time is the server clock. Client time is stored only as `client_captured_at`.
- Managers/admins need AAL2 (passkey or TOTP), enforced in RLS, not only in the UI.
- The service-role key never runs in a user request path. No PII or tokens in logs, URLs or analytics.
- Strict headers (nonce CSP, HSTS, `frame-ancestors 'none'`) are set centrally. Don't weaken them per page.
- Location data only when the org enables it **and** the employee consented. No biometrics stored.

## Code style
- Strict TypeScript, zod at every boundary (forms, RPC inputs, env).
- Server Components by default; client components only for interaction.
- Accessible first: real buttons and labels, visible focus, 18px base text, targets ≥48px (primary clock action ≥72px).
- No new dependency without a one-line reason in the PR description.
- Match the surrounding code. Comments explain *why*, not *what*.
