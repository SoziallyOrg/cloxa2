# Cloxa project handoff

Prepared: 26 September 2026. Workspace: `F:\sideProjects\cloxa2`.

Sources: current repository, phase reports, and previous **Recover Cloxa branding
state** chat. Current file/access checks happened on 26 September. Test results below
come from earlier work; no application, database, or browser tests ran during this
handoff.

## Read first

- Core product exists locally: invitation/login, employee clock, unpaid breaks,
  correction review, team administration, factual exports, and manager TOTP MFA.
- Precision A branding and isolated Auth fixtures reached merged main through PRs #13
  and #14.
- New workspace UX and cleanup/recovery work remain **uncommitted**: 76 existing changed
  files, 37 modified and 39 untracked. Index empty.
- Native workspace UX verification remains **incomplete**. Last run failed during
  desktop/mobile registration comparison and preserved its fixture data.
- Reusable clock-fixture cleanup passed separate native verification. One-time recovery
  command for preserved fixture exists, passes source checks, and **has not executed**.
- App and Mailpit URLs were unreachable during this handoff. No listeners appeared on
  expected Cloxa ports. Runtime must be checked and started before login.
- Production deployment, hosted infrastructure, real employee data, and production
  recovery remain outside completed scope.

## Product and technical setup

Cloxa serves one Dutch-speaking Flemish organization, one worksite, and roughly 5–20
employees. Employees record work and request corrections; managers review requests and
confirm fixed CSV/JSON snapshots.

Factual time tracking is implemented. Wage calculation, overtime rules, statutory rest,
payroll declarations, and legal compliance claims remain outside product scope.

| Area                   | Current setup                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------- |
| Web app                | Next.js 16.3.4 App Router, React 19.2.8, strict TypeScript                         |
| UI                     | Tailwind CSS 4.3.3, shared components, Dutch `nl-BE` copy                          |
| Auth/database          | Local Supabase Auth and PostgreSQL 17; tenant membership/RLS enforcement           |
| Workspace              | pnpm monorepo: `apps/web`, `packages/database`, `packages/domain`                  |
| Checks                 | Vitest, Playwright, pgTAP, ESLint, Prettier, dependency audit, browser secret scan |
| Runtime observed today | Node `v24.15.0`; pnpm `11.25.0`                                                    |
| Dates                  | Stored instants with Brussels display and explicit DST handling                    |

`packages/domain` remains an empty boundary. Current business rules live in app modules
and database contracts.

## Work completed

### Merged foundation

| Work                                                | Delivered behavior                                                                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Invitation and access                               | Invite-only login, password setup/recovery, active membership checks, fixed callback routes, Dutch feedback                        |
| Employee time clock                                 | Server-derived start/stop timestamps, one open shift per membership, request UUID retries, own registrations                       |
| Work-time corrections                               | Adjustment/missed-entry requests, withdrawal, manager approval/rejection, atomic factual application and retained decision history |
| Live unpaid breaks, Phase 7                         | Start/end break on open shift; open break blocks clock-out; exact gross/break/net arithmetic                                       |
| Historical break corrections and export v2, Phase 8 | Reviewed additions/adjustments/removals, retained revisions/tombstones, break-aware snapshots; existing v1 artifacts stay fixed    |
| Team administration, Phase 9                        | Employee names/codes, invitation status, suspension/reactivation, organization/worksite names; open work blocks suspension         |
| GitHub CI, Phase 10                                 | Clean-checkout checks, disposable local database, production browser journeys, audit and bundle scan; no deployment                |
| Manager MFA, Phase 11A / PR #11                     | Native TOTP, AAL2 enforcement across manager pages, database reads/RPCs and export downloads                                       |
| Local manager MFA recovery, Phase 11B / PR #12      | Exact operator start/status/complete flow, temporary recovery denial, replacement factor and fresh-session cutoff                  |
| Precision A branding, PR #13                        | Cloxa logo integration and shared visual treatment                                                                                 |
| Isolated local Auth fixtures, PR #14                | Run-owned fictional users/tenant, ownership proof, conservative cleanup; retained bootstrap manager excluded                       |

Local Git history confirms merges above. Phase reports describe their original delivery
checkpoints and can still contain old wording such as “unmerged.” Git history takes
precedence for merge state.

### Current uncommitted work

- Employee navigation now separates **Tijdklok / Registraties / Aanvragen**. Manager
  navigation uses **Overzicht / Aanvragen / Team / Meer**. Exports sit under Meer.
- Compact screens use bottom navigation; desktop uses rail from 928 CSS px. Shared grid
  aligns header, actions, content, and navigation.
- Employee header and clock panel share work status, quick actions, refresh coordinator,
  and mutation lock across navigation.
- Account disclosure contains logout. Scope changes/logout clear clock state; stale
  responses cannot restore previous account state.
- Registrations show compact Bruto/Pauze/Netto totals and one exact-details disclosure.
  Approved correction badges link to real decisions.
- Status labels use text plus semantic colors. Ordinary time inputs show minutes; exact
  timestamps remain available. DST occurrence choice appears when needed.
- Feedback repair limits duplicate announcements and returns focus to actionable
  feedback.
- Cleanup now proves exact clock/break graph, orders locks, restores five
  delete-blocking triggers inside transaction, and gates Auth deletion behind confirmed
  database cleanup.
- Native harness records protected recovery evidence before mutation and redacts
  ownership proofs after complete cleanup.
- Fixed one-time preserved-fixture recovery command and 17 focused tests exist. Command
  remains source-reviewed execution work, not completed recovery.

Main source groups: workspace shell/navigation, employee clock provider/coordinator,
registration display/provenance, local-time correction fields, and
`scripts/local-auth-e2e-fixture.mjs`. Current branch also contains separate synthetic UX
preview/tests and native cleanup harness repairs.

## Going well

- Core workflows have database authorization and retry contracts, plus unit, database,
  and native browser evidence from earlier phases.
- Corrections preserve claims and decision history. Export snapshots retain original
  bytes after later changes.
- Manager MFA recovery succeeded for retained local manager on 6 September. Fresh AAL2
  login opened dashboard; binding generation reached 2.
- UX checks cover narrow screens, wide desktops, larger text, focus, dialogs, and
  keyboard-occlusion simulations.
- Clock cleanup repair passed native refusal, rollback, trigger-restoration,
  concurrency, and unrelated-fixture preservation probes.
- Latest recovery source checks passed without touching preserved data.
- Current `.env.local` exists, contains required local settings, and remains
  Git-ignored.

## Going wrong or still uncertain

| Issue                                               | Evidence and impact                                                                                                                                                                                                          | Required follow-up                                                                                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native UX journey failed                            | Registration comparison mixed desktop `innerText` and mobile `textContent`; separator/newline differences broke assertion. Navigation, clock-in, two breaks, and clock-out passed before failure. Full journey did not pass. | Structured per-field assertions now exist; native rerun still pending.                                                                                                 |
| Preserved fixture remains unresolved                | Last confirmed snapshot contains two Auth users, one organization, one closed entry, two breaks, operation ledgers, MFA registration, invitation and audits. No recovery execution followed.                                 | Review fixed recovery command, obtain exact native execution approval, verify live ownership, then recover once.                                                       |
| Current native UX test exceeds proven cleanup scope | `begrensde native workspace UX` still continues into correction submission/approval. Cleanup explicitly rejects unsupported correction graphs.                                                                               | Bound next run before correction section, or review and prove correction cleanup support before exercising it. Running whole test now risks another preserved fixture. |
| Original local manager MFA mismatch unexplained     | Replacement recovery and fresh login succeeded on 6 September. Original cause remained unresolved.                                                                                                                           | Keep existing replacement authenticator; investigate only if mismatch recurs.                                                                                          |
| Synthetic browser teardown hung                     | 53 assertions passed in September repair run, but runner hung during teardown. Previous agent interrupted and confirmed its owned preview process stopped.                                                                   | Resolve teardown lifecycle and obtain clean process exit in next synthetic run.                                                                                        |
| Current services unavailable                        | 26 September: `/login` and Mailpit unreachable; expected ports had no listeners. Cause not diagnosed.                                                                                                                        | Check local Docker/project state; start existing stack without reset, then web app.                                                                                    |
| Current branch lacks complete final validation      | Latest changes have focused evidence; no complete green suite or CI result for all 76 working-file versions.                                                                                                                 | Finish recovery/native UX work, then run appropriate final gates and CI on reviewed commit.                                                                            |
| Device coverage incomplete                          | Chromium synthetic coverage exists. WebKit was absent; physical phone keyboard, notch, pinch zoom and Safari behavior remain unverified.                                                                                     | Test real iOS/Safari and Android browsers before pilot readiness claim.                                                                                                |
| Some evidence paths were temporary                  | Previous native UX report under OS Temp no longer exists. Two persistent review ZIPs still exist.                                                                                                                            | Use persistent bundles; preserve future handoff evidence outside Temp.                                                                                                 |

Older standalone strict TypeScript probe recorded 16 fixture/mock typing diagnostics;
subsequent workspace typecheck passed. Those results cover different scopes. If
standalone probe becomes required, reconcile diagnostics rather than presenting it as
green.

## Logins and access

### Local addresses

| Purpose                 | Address                          | Access                                                         |
| ----------------------- | -------------------------------- | -------------------------------------------------------------- |
| Cloxa login             | <http://localhost:3000/login>    | Manager or accepted employee credentials                       |
| Manager dashboard       | <http://localhost:3000/manager>  | Password plus registered TOTP                                  |
| Employee clock          | <http://localhost:3000/employee> | Accepted invitation and active employee membership             |
| Local mail inbox        | <http://127.0.0.1:54324>         | Invitation/recovery messages; configured local SMTP capture    |
| Supabase Studio         | <http://127.0.0.1:54323>         | Local administration UI; availability not reverified           |
| Supabase API            | <http://127.0.0.1:54321>         | Configured local client/server keys                            |
| PostgreSQL              | `127.0.0.1:54322`                | Local maintenance channel; inspect connection settings locally |
| Native browser test app | `http://127.0.0.1:3100`          | Dedicated test server, run-owned fixtures                      |
| Synthetic UX preview    | `http://127.0.0.1:3174`          | Presentation fixture only; no real login/Auth/database         |

Addresses describe configuration, not running services. Login and Mailpit were
unreachable during handoff.

### Accounts and credential locations

Local credential file:
[apps/web/.env.local](F:/sideProjects/cloxa2/apps/web/.env.local). Values exist; handoff
does not copy secrets into versioned documentation.

| Account/setting                     | Identifier or location                                             | Notes                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Retained bootstrap manager          | `manager.local@example.test`                                       | Confirmed email from local configuration                                                                                |
| Manager password                    | `CLOXA_LOCAL_MANAGER_PASSWORD` in ignored file                     | Read privately on owner machine                                                                                         |
| Manager second factor               | Owner's replacement authenticator entry from 6 September recovery  | Fresh TOTP required; password alone cannot open manager data                                                            |
| Previously designated demo employee | `demo.employee.20260906.a5056443@example.test`                     | Fictional name/code: `Fictieve demonstratiemedewerker`, `DEMO-01`. Invitation acceptance/current access not reverified. |
| Demo employee password              | Password chosen during invitation acceptance                       | No confirmed demo password in handoff evidence                                                                          |
| Generated employee test password    | `CLOXA_LOCAL_EMPLOYEE_PASSWORD`                                    | Fixture credential; do not assume this matches manually created demo account                                            |
| Generated reset test password       | `CLOXA_LOCAL_EMPLOYEE_RESET_PASSWORD`                              | Test recovery workflow credential                                                                                       |
| Public local API configuration      | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Current URL points to loopback stack                                                                                    |
| Privileged server key               | `SUPABASE_SECRET_KEY`                                              | Server-only; bypasses RLS; keep outside browser bundles and Git                                                         |
| Repository                          | <https://github.com/SoziallyOrg/cloxa2>                            | Existing GitHub account access; GitHub credentials not collected                                                        |

Keep passwords, TOTP codes, QR/manual keys, tokens, session cookies, service keys, and
raw fixture ownership proofs out of this document, chat, tickets, and review ZIPs.
Transfer secrets through an approved private channel if another operator needs access.

Employees join through manager invitation and local Mailpit link, then set their own
password. Public signup remains disabled. Use separate browser profiles/private windows
for manager and employee sessions. Supabase rejects fresh administrator invitations to
already-confirmed Auth accounts; do not assume resend/reinvite exists.

Registered managers must verify their bound factor during password reset. Missing factor
goes to recovery-required state. Fixed recovery CLI supports synthetic local manager
only; hosted/support recovery does not exist. Expired recovery after replacement
enrollment can retain a verified candidate and require separate operator handling.

## Repository checkpoint

| Item                                  | Observed value                                  |
| ------------------------------------- | ----------------------------------------------- |
| Branch                                | `codex/acceptance-ux-polish`                    |
| HEAD                                  | `dae2255c221433858dcbfbd6b676151b71349f19`      |
| Cached `origin/main`                  | Same SHA; no network refresh during handoff     |
| Existing working files before handoff | 76: 37 modified, 39 untracked                   |
| Staged files                          | None                                            |
| Last local merge                      | PR #14, isolated local Auth E2E fixtures        |
| This request                          | Adds `HANDOFF.md` only; preserves existing work |

Existing Git metadata also lists three older worktree entries as `prunable`, for manager
MFA, employee corrections, and manager correction review. Their lifecycle was not
changed. Confirm ownership/recovery needs before any cleanup.

Do not reset, discard, broadly stage, or delete current work. New untracked source files
are required parts of UX/recovery work. Existing `.env.local`, review captures, and
dependency/runtime folders remain excluded from Git.

## Preserved fixture recovery checkpoint

These identifiers are historical exact targets from reviewed source and 13 September
evidence. Current database contents were not queried during handoff.

| Reference             | Value                                                              |
| --------------------- | ------------------------------------------------------------------ |
| Fixture run           | `a3a76fea-4c19-45cd-9fa4-750432f20d94`                             |
| Organization          | `6ba3fda2-97f5-4b0b-86a3-4e3f372fd164`                             |
| Manager Auth user     | `e5a5b363-c46a-4bf9-b43c-5165a4776124`                             |
| Employee Auth user    | `a449e191-5d60-47d2-bde9-03dadd04bc49`                             |
| Preservation SHA-256  | `88f34aaed7ab9fc190dc5ec781d250ffc4b25487e2b472ba1b4c1af622592947` |
| Command source        | `scripts/local-auth-preserved-fixture-recovery.mjs`                |
| Focused tests         | `tests/local-auth-preserved-fixture-recovery.test.ts`              |
| Command documentation | `scripts/README.md`, “One-time preserved fixture recovery”         |

Expected graph: 2 Auth users, 1 organization, 1 worksite, 2 profiles, 2 memberships, 1
invitation, 1 time entry, 2 breaks, 2 clock requests, 4 break operations, 9 audits, 1
verified manager TOTP factor and 1 matching MFA registration. Correction requests, break
revisions, and unsupported references must remain zero.

Recovery requires all six exact confirmations: local development, run, organization,
manager, employee, preservation digest. Command verifies exact identities and
server-owned proof, reads catalog/snapshot, rechecks graph under locks, then performs
database cleanup followed by employee Auth deletion and manager Auth deletion. Protected
evidence records confirmed boundaries; complete cleanup redacts proof.

**Latest authorization was “build, but do not execute.”** Source review and separate
explicit native approval remain prerequisites. Do not use broad database reset,
email/marker deletion, factor sweep, or blind cleanup replay. Current live ownership and
unchanged graph must pass command checks before mutation. Native cleanup uses table-wide
locks; establish quiescent local stack without stopping someone else's job.

## Verification evidence

Counts belong to separate checkpoints and scopes. Do not add them together or treat
historical results as validation of current branch.

| Checkpoint                             | Recorded result                                                                                                                                              | Practical limit                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Phase 11B foundation                   | 1,014 unit/integration tests; 91 production browser passes, 3 intentional skips; 8 native local recovery passes; database/build/lint/type/audit gates passed | Earlier foundation state; not current UX branch                            |
| Workspace/grid UX, 9 September         | 648 focused unit checks, 50 synthetic browser checks; typecheck/lint/format/build passed                                                                     | Synthetic routing/actions, no native session proof                         |
| Feedback/cleanup repair, 10 September  | Focused unit groups passed; 53 synthetic browser assertions passed; typecheck/lint/format/build passed                                                       | Browser teardown hung; whole invocation lacked clean completion            |
| Native workspace UX, 10 September      | Real navigation, coordinated clock-in/out and two breaks passed before registration assertion failure                                                        | Full journey failed; correction stage not reached; resources preserved     |
| Native cleanup harness, 13 September   | One invocation passed in 9.202s; refusal probes, 10 rollback probes, concurrent writer and sentinel preservation passed; 66 postcondition counts zero        | Harness target/sentinel cleaned; original preserved fixture unchanged      |
| One-time recovery source, 13 September | 17 new tests; 85 combined fixture/recovery/harness tests; workspace typecheck, syntax, ESLint, formatting and diff checks passed                             | Recovery never executed; native harness not rerun for this source addition |

Latest native cleanup evidence reached `cleaned`, 22 checkpoints,
`resourcesRemaining: false`, and redacted both harness proofs. That result applies to
fresh harness target/sentinel, **not** preserved UX run.

## Next steps, in order

1. Preserve current source and persistent review bundles. Read this checkpoint before
   switching branches or changing local data.
2. Review one-time recovery source against exact preserved graph and evidence. Resolve
   any review findings before requesting native execution approval.
3. Check Docker and local project `cloxa2`. Restore existing services without database
   reset. Confirm local endpoint/key match and no competing fixture writer.
4. After explicit approval, execute fixed recovery once. Confirm database graph removal,
   employee/manager Auth deletion, enabled triggers, redacted evidence, and preservation
   of retained manager/demo/unrelated data. Stop on ambiguity; do not retry blindly.
5. Bound native UX test to reviewed clock/navigation/registration cleanup scope. Current
   source still includes correction mutations; remove or guard that segment for bounded
   rerun, or approve and prove expanded cleanup first.
6. Rerun native workspace verification with fixed registration assertions. Require clean
   fixture cleanup and clean process exit. Resolve synthetic teardown hang and rerun
   presentation checks.
7. Review all current source as one coherent change. Check scope compliance plus
   authorization/security, stale clock responses, logout/scope boundaries, exact-time
   preservation, correction provenance, and accessible navigation.
8. Run final gates appropriate to reviewed source. Preserve existing local data; use a
   separate disposable environment for any reset-based validation. Run CI against
   reviewed commit, then create/update focused PR under separate delivery authorization.
   No auto-commit, push, merge, or deploy follows from this handoff request.
9. Validate real phones/Safari and complete manager/employee acceptance journey before
   pilot readiness decision. Resolve production mail, hosted setup, identity-proofed
   manager recovery, backups/restore, monitoring, and data-retention decisions before
   real employee use.

## Local startup and safe checks

Run from `F:\sideProjects\cloxa2`. Commands below describe next operator steps; none ran
during handoff except runtime version checks.

For existing environment, start Docker Desktop if needed, start existing local services,
then launch app in separate terminal:

```powershell
pnpm supabase:start
pnpm dev
```

Open login and Mailpit URLs above. Existing environment already has credential settings.
Bootstrap/credential helpers belong to fresh or missing-fixture setup; do not rerun them
as password/MFA repair.

Service-free source checks:

```powershell
pnpm typecheck
pnpm lint
pnpm exec prettier --check .
git diff --check
pnpm exec vitest run tests/local-auth-preserved-fixture-recovery.test.ts tests/local-auth-e2e-fixture.test.ts tests/local-auth-e2e-cleanup-harness.test.ts
```

Synthetic UX command, after resolving teardown issue:

```powershell
pnpm exec playwright test --config playwright.ux.config.ts
```

Native local Auth command is `pnpm test:e2e:local-auth`. **Do not run full current suite
until correction segment/cleanup mismatch and preserved fixture recovery are resolved.**
Native tests mutate synthetic local data. Database reset removes local fixtures and is
not a startup/troubleshooting step for retained environment.

CI workflow contains full production verification order, including disposable reset. Its
reset/cleanup steps belong to disposable runner, not retained local pilot state.

## Important files and persistent evidence

| Reference                                                                                           | Purpose                                                        |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [README.md](F:/sideProjects/cloxa2/README.md)                                                       | Setup, auth, authorization, product workflows and validation   |
| [PRODUCT.md](F:/sideProjects/cloxa2/PRODUCT.md)                                                     | Product boundaries and intended users                          |
| [DESIGN.md](F:/sideProjects/cloxa2/DESIGN.md)                                                       | Current visual/workspace conventions and UX validation limits  |
| [BUSINESS_PLAN.md](F:/sideProjects/cloxa2/BUSINESS_PLAN.md)                                         | Commercial assumptions; no validated customers/metrics implied |
| [PHASE_11_STATUS.md](F:/sideProjects/cloxa2/PHASE_11_STATUS.md)                                     | Manager MFA and local recovery foundation evidence             |
| [scripts/README.md](F:/sideProjects/cloxa2/scripts/README.md)                                       | Fixture setup, cleanup and operator recovery contracts         |
| [MANAGER_MFA.md](F:/sideProjects/cloxa2/packages/database/MANAGER_MFA.md)                           | Assurance, recovery and session-cutoff contract                |
| [TIME_EXPORT_V2.md](F:/sideProjects/cloxa2/packages/database/TIME_EXPORT_V2.md)                     | Factual export semantics, limits and immutable artifacts       |
| [ci.yml](F:/sideProjects/cloxa2/.github/workflows/ci.yml)                                           | Required disposable-runner checks                              |
| [Local demo findings](C:/Users/Samim/cloxa-demo-acceptance-20260906-212247-a5056443/BEVINDINGEN.md) | Manager MFA incident/recovery context; file still exists       |

Persistent source-review bundle, verified present during handoff:

[cloxa-preserved-fixture-recovery-review-2026-09-13-20260913111850-74d5169e.zip](C:/Users/Samim/.codex/visualizations/2026/09/06/01a075e7-19d0-71a1-b3e5-d5ac5f6f089b/cloxa-preserved-fixture-recovery-review-2026-09-13-20260913111850-74d5169e.zip)

Recorded SHA-256: `78a50bcd12f76aa8955b1f2ab5a79141473f443a7ca19d9c85ae12c2153419f5`.

Persistent native harness evidence, verified present during handoff:

[cloxa-native-clock-fixture-cleanup-evidence-2026-09-13-20260913101412.zip](C:/Users/Samim/.codex/visualizations/2026/09/06/01a075e7-19d0-71a1-b3e5-d5ac5f6f089b/cloxa-native-clock-fixture-cleanup-evidence-2026-09-13-20260913101412.zip)

Recorded SHA-256: `c7d6a0bed009b4262ffa02911231bb2120ca588b7395421cdadcb97f3def0965`.

Bundle hashes above come from earlier delivery reports; file presence was checked today.
Temp-based native UX report path no longer exists. Copy persistent bundles through
approved handoff channel and verify their hashes before relying on archived source.

## Remaining product limits

- One supported active membership per user; no tenant switcher or multiple-worksite
  flow.
- Employee history uses bounded readers: 20 closed entries and 50 requests. Manager
  queue shows pending requests and 50 recent terminal requests; team/invitations bounded
  at 100 each.
- Export selection spans 1–31 Brussels days; 10,000-entry and 10 MiB ceilings. Export
  history shows 20 recent snapshots. Full-history pagination absent.
- v2 handles unpaid breaks; new v1 exports reject selected entries with break history.
  Existing v1 downloads remain fixed.
- Export period groups whole overnight shift by Brussels start date. Display minutes do
  not round stored facts or export arithmetic.
- No hosted deployment, production delivery integration, public signup, billing, offline
  mode, realtime subscription, scheduled export, native app, payroll calculation, or
  complete hosted incident-recovery process.
- Customer validation and representative employee acceptance remain future work.
  Repository supplies no real customer metrics or compliance evidence.

## Handoff work performed today

Inspected repository state/history, current product/setup/phase documents, local
configuration names and non-secret URL/email values, previous project chat, current
source boundaries, runtime versions, listening ports, and persistent evidence presence.
Added this handoff document. Existing 76 working files, accounts, MFA, database and
services were not changed.
