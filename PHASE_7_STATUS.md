# Phase 7 verification report

Status: dependency audit gate cleared; PR remains draft for final independent
verification.

Branch: `feat/employee-live-breaks`. Existing draft PR:
https://github.com/SoziallyOrg/cloxa2/pull/7. Repair began with clean working tree and
local/remote heads both at `fa31f49c4f624060037e5656ba1665b7fac5018f`. Original baseline
`9f4e9c1` contains required Phase 6 commit `ead22cb07b080deb1433e7c41daf17db44e694d5`.
No new branch or PR was created.

## Focused repair

Every new or replayed break response includes submitted `request_id`. New outcomes
persist it atomically; replay of an older outcome adds that same public correlation UUID
without rewriting private ledger history. Unmerged Phase 7 migration is repaired; merged
migrations, authorization, lock order, rollback, and audit behavior are unchanged.

Server Action accepts exactly eight response keys: `request_id`, `result_code`,
`did_transition`, `break_id`, `time_entry_id`, `started_at`, `ended_at`, and `version`.
It validates UUIDs, matching request ID, operation/result compatibility, boolean state,
calendar-valid timestamps at microsecond precision, interval positivity, version,
missing keys, extra keys, and contradictory facts.

| Result           | Required facts                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| started          | Start operation, transition true, valid break/entry IDs, open interval, version 1                  |
| ended            | End operation, transition true, valid IDs, positive closed interval, version 2                     |
| no_open_shift    | Either operation, transition false, all fact fields null                                           |
| already_on_break | Start operation, transition false, valid open break/entry, version 1                               |
| no_open_break    | End operation, transition false, valid entry ID, null break fields                                 |
| invalid_interval | Transition false; start has valid entry and null break fields; end has valid open break, version 1 |

Validated blockers revalidate `/employee` and return submitted UUID with controlled
Dutch feedback, completing that operation without claiming a new transition. Transport
exceptions, provider errors, missing/malformed results, and uncertain outcomes return no
completed UUID and do not revalidate. Panel preserves UUID when previous completed
feedback becomes uncertain, allowing safe replay.

Recovery test uses two tabs without reload: stale start receives `already_on_break`,
refreshes to on-break state, and retires UUID; after other tab ends break, stale end
receives `no_open_break`, refreshes to working state, retires UUID, and next start
succeeds under a different UUID. Feedback focus and persisted operation outcomes are
checked on desktop and mobile.

`apps/web/next-env.d.ts` was restored byte-for-byte from `origin/main` after production
build and is absent from final PR source diff. Dependency files are unchanged.

## Final sequential verification

Focused tests ran first: 55 action-contract cases; 110 time-clock tests across 6 files;
104 focused pgTAP assertions; 2 stale-tab browser recovery runs passed. Initial focused
SQL attempt encountered leftover synthetic fixtures; clean local reset removed them.

Final gate pass then ran in order:

- Clean local Supabase reset: passed.
- All pgTAP: 9 files, 1,052 assertions passed; 104 break assertions included.
- Database lint: public/private passed, no schema errors.
- Generated-type freshness: passed, stored types current.
- Formatting and diff whitespace: passed. Windows checkout line endings on next-env were
  restored to exact Git blob bytes before continuing.
- ESLint and all TypeScript checks: passed.
- Unit/integration: 36 files, 649 tests passed; zero skipped.
- Production build: passed.
- Complete production Playwright: 63 passed, 3 existing project-specific skips (66
  total), including 12 break test runs. Desktop-only export races and mobile-only
  exact-320px dialog coverage account for those existing skips.
- Production dependency audit: passed in fresh clean-room run against exact repair
  commit on separate VPS network; exit 0, "No known vulnerabilities found". Evidence
  below replaces final local timeout blocker, independently of earlier preflight.
- Scoped credential scan: 38 Phase 7 files, zero findings.
- Browser-bundle secret scan: 20 production bundle files, no server secret.

Earlier WSL/Docker outage and registry timeout are historical interruptions, not passing
evidence. User restored Docker before final verification. All database/browser work used
synthetic local data only. Subsequent audit used existing VPS temporary directory;
hosted websites and services were unchanged. No real employee data, merge, or deployment
was involved. Existing PR remains draft, never marked ready.

## Clean-room dependency audit clearance

- Audited commit: `7129cda20ea60ddf756ba3fbf105b6e8c279d511`, verified with
  `git rev-parse HEAD` after public HTTPS clone and detached checkout.
- Runner: Hostinger VPS clean-room runner; disposable directory outside hosted websites,
  with isolated home, configuration, and tooling caches.
- Run started: `2026-09-04T08:02:07Z`. Audit started: `2026-09-04T08:02:14Z`; finished:
  `2026-09-04T08:02:33Z`.
- Node `v24.18.0`; Corepack `0.35.0`; pnpm `11.25.0`, matching declared `pnpm@11.25.0`.
  Corepack shim and package-manager cache stayed in temporary directory.
- Registry: `https://registry.npmjs.org/`.
- Exact command: `pnpm audit --prod --audit-level high`.
- One attempt, externally bounded to 180 seconds; audit exit code **0**; result: **No
  known vulnerabilities found**. No suppression or cached/preflight result substituted
  for this run.
- Clone remained clean and lockfile hash unchanged. No application dependencies,
  lifecycle scripts, npm lockfile, dependency updates, app, database, Docker services,
  web server, or port changes. No local secrets, environment files, or data copied.
- Cleanup trap removed disposable directory; separate SSH check confirmed directory
  absent and exited 0. Later SSH-wrapper CRLF error (wrapper exit 2) did not affect
  captured audit result (exit 0).
- Local branch and remote still matched audited commit with clean working tree before
  documentation update. Only this report changes in clearance commit; PR description
  receives matching evidence. Documentation formatting and diff checks only; prior
  database, unit, build, and browser suites were not rerun.

## Phase 7 behavior and limits

Tenant-bound `public.time_breaks` records live unpaid intervals with composite tenant,
employee, worksite, and parent-entry foreign keys. Open rows start at version 1; only
closing update increments to version 2. Closed facts and retry ledgers have normal-role
history guards. Employees read own breaks; authorized managers read same-tenant facts.
Application roles have no direct break writes. Database owners can disable guards;
storage is not tamper-proof.

Auth/session validation and employee advisory namespace 17031 serialize operations
before ownership and fact locks; namespace 17061 binds break UUIDs to actor and intent.
Minimal `time_break.started` / `time_break.ended` audits commit atomically with facts
and outcomes. Tests retain duplicate replay, mixed clock/break concurrency,
authorization expiry during lock waits, fact/audit rollback, and correction containment
coverage.

Clock-out refuses open breaks. Correction conflicts preserve pending requests and
recorded facts. New v1 exports block break-bearing selected entries with
`break_data_requires_v2`, creating no export metadata, snapshot, audit, or artifact.
Existing v1 CSV/JSON bytes and hashes remain unchanged and covered by production tests.
Dutch UI shows exact BigInt totals, Brussels intervals, and explicit open states.

Only live unpaid facts are supported. Historical/manual breaks, break corrections,
automatic/statutory breaks, payroll calculations, export v2, scheduling, geolocation,
and native apps remain unimplemented. No compliance or production-readiness claim.

## Exact repair file inventory

- `PHASE_7_STATUS.md`
- `apps/web/e2e/employee-live-breaks.spec.mts`
- `apps/web/next-env.d.ts`
- `apps/web/src/components/time-clock-panel.tsx`
- `apps/web/src/i18n/nl-BE.ts`
- `apps/web/src/lib/time-clock/break-actions.test.ts`
- `apps/web/src/lib/time-clock/break-actions.ts`
- `apps/web/src/lib/time-clock/break-response.ts`
- `supabase/migrations/20260903230921_employee_live_breaks.sql`
- `supabase/tests/employee_live_breaks.test.sql`

## Full Phase 7 file inventory against origin/main

- `.impeccable/design.json`
- `DESIGN.md`
- `PHASE_7_STATUS.md`
- `PRODUCT.md`
- `README.md`
- `apps/web/e2e/employee-live-breaks.spec.mts`
- `apps/web/src/components/break-summary.tsx`
- `apps/web/src/components/correction-request-panel.tsx`
- `apps/web/src/components/manager-correction-panel.tsx`
- `apps/web/src/components/manager-export-panel.tsx`
- `apps/web/src/components/time-clock-panel.tsx`
- `apps/web/src/i18n/nl-BE.ts`
- `apps/web/src/lib/corrections/actions.test.ts`
- `apps/web/src/lib/corrections/actions.ts`
- `apps/web/src/lib/corrections/model.test.ts`
- `apps/web/src/lib/corrections/model.ts`
- `apps/web/src/lib/manager-corrections/actions.test.ts`
- `apps/web/src/lib/manager-corrections/actions.ts`
- `apps/web/src/lib/manager-corrections/model.test.ts`
- `apps/web/src/lib/time-clock/actions.test.ts`
- `apps/web/src/lib/time-clock/actions.ts`
- `apps/web/src/lib/time-clock/break-actions.test.ts`
- `apps/web/src/lib/time-clock/break-actions.ts`
- `apps/web/src/lib/time-clock/break-response.ts`
- `apps/web/src/lib/time-clock/breaks.test.ts`
- `apps/web/src/lib/time-clock/breaks.ts`
- `apps/web/src/lib/time-clock/format.ts`
- `apps/web/src/lib/time-clock/model.test.ts`
- `apps/web/src/lib/time-clock/model.ts`
- `apps/web/src/lib/time-exports/actions.test.ts`
- `apps/web/src/lib/time-exports/actions.ts`
- `apps/web/src/lib/time-exports/model.ts`
- `packages/database/README.md`
- `packages/database/TIME_EXPORT_V1.md`
- `packages/database/src/database.types.ts`
- `supabase/migrations/20260903230921_employee_live_breaks.sql`
- `supabase/tests/README.md`
- `supabase/tests/employee_live_breaks.test.sql`
