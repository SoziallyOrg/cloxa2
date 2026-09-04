# Phase 9 verification report

## Focused suspended-correction repair

Starting branch `feat/manager-team-administration`, HEAD
`65991ea4e18eb4d040773d7794d01df1ec9f97f4`, clean tree, unchanged main/base
`4c368bbad711d5628269f84a6fcb343ba2f55b98` and open draft PR #9 verified before edits.

Additive migration `20260904132424_suspended_correction_review.sql` replaces only
`private.decide_correction_request` and `private.decide_break_correction`. Approval
accepts tenant-bound active/suspended employee targets. Active targets retain exactly
one active membership; suspended historical targets may have another active membership
elsewhere. Existing rejection behavior stays unchanged. No reactivation, membership/
Auth/session mutation, public signature/wrapper/grant/RLS/result-code change, or earlier
migration edit. Employee old-tenant reads/submissions/withdrawals remain denied.

Targeted production workflow tests: 4 passed (33.5 seconds), both correction families on
desktop and exact 320px. Real employee submission, manager suspension, manager-page
approval, terminal status, factual/revision application, minimal audit and continued
employee route/clock/organization denial were checked. Full membership row stays equal
before/after approval. No production application changes were needed.

First targeted run had 2 passes and 2 failures: a new test incorrectly used service-role
SELECT on protected break-history tables, and one worker failed local CLI lookup before
test body. Test inspection now uses existing authenticated manager read grants; no grant
was widened. An ignored, credential-redacting observer recorded successful overlapping
worker CLI discovery on corrected targeted run. Original underlying lookup error was
discarded by existing helper; cause remains unconfirmed. No retries, sleeps, skips,
suite serialization or committed harness instrumentation were added. Failed worker:
desktop break case in `suspended-correction-review.spec.mts`, reported test duration 0
ms (failure before test body, not measured CLI duration). Discovery command:
`node node_modules/supabase/dist/supabase.js status --output json`. Complete retained
helper error: `Local Supabase is unavailable. Start Docker and pnpm supabase:start.` The
discarded provider stderr cannot be reconstructed.

Independent static review confirmed exactly two private replacements; only approval
availability predicates differ from Phase 8 bodies. Public contracts, grants, locking,
authorization, factual safeguards, replay and audits remain unchanged.

Targeted pgTAP passed 153 assertions. Tests cover both decision families, exact replay
and payload binding, other-active-tenant isolation, active ambiguity, denied historical
tenant access, unchanged membership/Auth/session rows, minimal audit payloads and
rollback after audit insertion failure. Invited/inactive approvals remain unavailable;
existing rejection behavior for unavailable claims stays unchanged.

The first unit run used filesystem sandboxing: 921 tests passed and five local-stack
checks could not start. An isolated diagnostic captured CLI exit 1 after
`FileSystem.writeFile` failed with `EPERM` on its local telemetry temporary file (442 ms
isolated probe). The same unit gate passed with local filesystem permission: 44 files,
926 tests. This explains that unit-run failure, not the earlier browser lookup failure.
The repository helper still contains provider errors; diagnostic output stays ignored.

Repair inventory (six files):

- `supabase/migrations/20260904132424_suspended_correction_review.sql`
- `supabase/tests/suspended_correction_review.test.sql`
- `apps/web/e2e/suspended-correction-review.spec.mts`
- `packages/database/MANAGER_TEAM.md`
- `packages/database/README.md`
- `PHASE_9_STATUS.md`

All 30 unrelated baseline paths remain HEAD-identical, unstaged and LF in the index and
working tree. Repository-local `core.autocrlf=false` remains uncommitted; global Git
settings, `.gitattributes`, Prettier, dependencies, lockfile, earlier migrations,
generated types, `next-env.d.ts` and test harness have no repair diff. Build-generated
`next-env.d.ts` path drift was restored to its original content.

### Repair verification gates

| Gate                                    | Result                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------ |
| 1. Clean local Supabase reset           | Passed; additive repair migration applied                                |
| 2. Complete pgTAP                       | 12 files, 1,649 assertions passed; includes 153 new assertions           |
| 3. Database lint                        | Public/private schemas: zero errors                                      |
| 4. Generated types                      | Regenerated; freshness check passed; zero tracked changes                |
| 5. Formatting and diff                  | Passed; only new status prose needed formatting; no baseline changes     |
| 6. ESLint                               | Passed with zero warnings                                                |
| 7. TypeScript                           | All three workspaces passed                                              |
| 8. Unit/integration                     | 44 files, 926 tests passed after local filesystem permission correction  |
| 9. Production build                     | Passed; 21 page-generation tasks completed                               |
| 10. Focused production journeys         | 32 passed, zero skips/failures (1.4 minutes)                             |
| 11. Complete production browser suite   | One run: 83 passed, 3 existing skips, zero failures (2.3 minutes)        |
| 12. Production dependency audit         | One official npm registry request; no known vulnerabilities              |
| 13. Credential and browser-secret scans | Six repair files: zero findings; 24 production bundles: no server secret |

Focused journeys cover manager team, manager time corrections, break corrections and the
new suspended-review spec. Complete suite discovers 86 cases: original 82 plus four new
desktop/mobile cases. Three existing export viewport skips remain unchanged: desktop
skips the mobile-only focus journey; mobile skips the two desktop export
concurrency/expiry journeys. Both final production runs had no CLI lookup failure. Tests
kept two workers, zero retries and unchanged assertions in all older specs.

Decisions preserve employee suspension and old-tenant access denial throughout review.
Existing export capture/serialization logic and stored v1/v2 snapshot, hash, CSV and
JSON bytes remain unchanged; future exports can include approved corrections through
existing fact/revision rules. No new dependencies, production application changes, RLS
changes, hosted access, deployment or merge. Existing draft PR #9 remains the review
target.

Original Phase 9 delivery evidence follows unchanged.

## Original Phase 9 delivery

Status: all final gates passed; prepared for draft PR review. No merge, deployment,
hosted Supabase or VPS access. Synthetic local data only.

Branch: `feat/manager-team-administration`. Required base:
`4c368bbad711d5628269f84a6fcb343ba2f55b98`. HEAD, local main and origin/main matched
base before edits. Read-only remote main check also matched. Branch already existed at
exact base with clean tree; no existing work was overwritten. Phase 8
migration/status/contracts present. No hosted project-ref linked.

## Delivered scope

Dutch `/manager/team`, linked from manager home, contains pilot names, bounded employee
roster, optional account email, access status, factual open-shift/open-break warnings,
pending time/break request counts, inline profile edits, explicit
suspension/reactivation and invitation status history. Fixed timezone is
Europe/Brussels. Existing local-only invitation form remains linked; no resend or
Auth-account administration was added.

Four controlled RPCs and one private append-only operation ledger; no new application
table-update grants or coworker-profile policies. Current-session live manager checks
repeat after waits. Namespace 17081 binds all Phase 9 request IDs; existing 17031
coordinates employee workflows and exports, 17022 coordinates membership admission.
Exact response keys, result codes, normalization, grants and audit fields:
[manager team contract](packages/database/MANAGER_TEAM.md).

Suspension affects only active employee membership status and is blocked by open shifts
or breaks. Pending claims, factual history, break revisions, exports, invitations and
Auth/session records remain unchanged. Reactivation restores same membership only when
no other active membership exists. No best-effort session revocation is required.

Manager-edited name/code/worksite values affect future reads and exports. Existing v1/v2
snapshots, hashes and CSV/JSON bytes remain unchanged. Organization name is not added to
export formats. Employee self-profile display-name/locale permissions remain intact.

Normalized code uniqueness includes every non-null membership code within organization.
Migration aborts on pre-existing duplicates. Legacy invitation-code collisions preserve
existing code or leave optional code null for manager review; original acceptance
authorization, payload, response/audit shape and local mail boundary remain intact.
Phase 8 browser fixture now leaves manager code null; employee fixture code is
unchanged. All Phase 1–8 pgTAP files remain unchanged.

## Verification and repaired failures

Focused Phase 9 pgTAP: 219 assertions passed. Includes real historical revision and
complete before/after factual, claim, export, invitation, Auth/session and profile
values. Focused application: 141 tests passed. After final UI review fixes, focused
production Playwright: 10 passed, zero skipped, desktop and exact 320px. Real-session
races cover duplicate profile requests, cross-action UUID reuse, clock-in/suspension,
v1/v2 export/profile/settings and session expiry after employee lock wait. UI checks
cover pending counts, focus, escaped hostile text, access loss/restoration, invitation
states and no URL/log leakage.

Final gates executed sequentially:

| Gate                 | Result                                                         |
| -------------------- | -------------------------------------------------------------- |
| 1. Clean local reset | Passed, including Phase 9 migration                            |
| 2. Complete pgTAP    | Passed: 11 files, 1,496 assertions; 219 Phase 9                |
| 3. Database lint     | Passed: public/private, no schema errors                       |
| 4. Generated types   | Regenerated and freshness check passed                         |
| 5. Prettier          | Passed after checkout-local LF repair; no baseline source diff |
| 6. Diff check        | Passed, no whitespace errors                                   |
| 7. ESLint            | Passed, zero warnings                                          |
| 8. TypeScript        | Passed, all 3 workspaces                                       |
| 9. Unit/integration  | Passed: 44 files, 926 tests                                    |
| 10. Production build | Passed; build-time secret scan checked 24 browser files        |
| 11. Focused browser  | Passed: 10 tests, desktop and exact 320px, no skips            |
| 12. Complete browser | Passed: 79 passed, 3 existing skips, zero failures; 82 tests   |
| 13. Production audit | Passed: official npm registry, no known vulnerabilities        |
| 14. Credential scan  | Passed: all 25 final changed files, zero findings              |
| 15. Browser secrets  | Passed: 24 production browser files, no server secret          |

Gate 5 was a checkout line-ending problem: all 30 flagged baseline paths had index LF
and working-tree CRLF. Repository-local/global `core.autocrlf` and `core.eol` were
unset; system `core.autocrlf=true` supplied effective conversion. Text/eol attributes
were unspecified. Only repository-local `core.autocrlf=false` was set. Exact verified
HEAD/index-identical baseline blobs were restored with LF; index stat metadata was
refreshed. All 30 now report `i/lf w/lf`, absent from status, staged diff and tracked
diff. All 21 Phase 9 file fingerprints remained identical during repair. Exact path list
and evidence are retained in ignored local review files. Prettier 3.9.6, its
configuration, dependencies, global Git settings and `.gitattributes` were not changed.
No baseline formatting will be committed. Earlier PowerShell stdin comparison was not
byte-preserving and did not establish a source-formatting defect.

Initial failed production run took 2.1 minutes (50 passed, 29 failed, 3 skipped). All
ten Phase 9 journeys passed in that run. Twenty-eight failures occurred in older
membership fixtures. `employee-corrections.spec.mts:67` reuses `E2E-CORRECTION` and
`employee-time-clock.spec.mts:70` reuses `E2E-CLOCK` within shared organization.
`employee-live-breaks.spec.mts:88` and `manager-corrections.spec.mts:88` give manager
and employee the same code. Those fixture assumptions conflict with Phase 9 normalized
same-organization uniqueness. Exact contained errors:
`Synthetic local correction membership creation failed.`,
`Synthetic local time-clock membership creation failed.`, and
`Synthetic review membership failed.` Initial run stopped before later gates.

User-authorized follow-up changes only four synthetic allocators and this report.
Shared-organization clock/correction fixtures derive an 18-hex test/repeat prefix, then
select highest retained nine-digit sequence for that prefix and increment it. Codes stay
within 32 characters; projects/tests have distinct prefixes and sequential runs preserve
old facts. Fresh-organization review/break fixtures derive employee code from
organization/test/repeat identity; manager code is null. No new randomness, production
constraint change, assertion removal, added skip, serializer/golden change, or suite
serialization. There is no common allocator shared by these four files.

Original CLI command was Node running
`node_modules/supabase/dist/supabase.js status --output json`, from repository root.
Failure belonged to chromium-mobile, `foundation.spec.ts:15:7`,
`/ toont Nederlandse routeshell`, reporter item 56. Complete retained error message:
`Local Supabase is unavailable. Start Docker and pnpm supabase:start.` Stack:
`getLocalStackStatus` at `scripts/local-auth-config.mjs:105:11`, then
`playwright.config.ts:19:21`. Body duration was 0ms (config load); suite duration 2.1
minutes. Exact wall-clock failure time, worker index/PID and underlying command
stderr/exit details were not retained by existing catch boundary, so cannot be
reconstructed honestly.

Installed Playwright worker loader calls `deserializeConfig`, which reloads config;
top-level CLI lookup can therefore run concurrently in separate workers. No claim that
overlap caused original failure. Isolated same mobile root-route test passed (1 test,
body 514ms), with unchanged local-origin/key validation and no harness fix. Initial
anchored grep matched no tests; corrected title selector selected exactly one. Read-only
CLI status also succeeded. Treat original as one unreproduced transient local lookup
failure. Separate sandboxed `status --help` failed on CLI telemetry-cache EPERM;
approved help succeeded. That permission diagnostic does not establish original cause.
Three full-suite skips remain existing viewport-specific export tests.

Authorized targeted production rerun passed all 30 tests across four affected specs (1.2
minutes), zero skips or CLI failures, with existing two-worker concurrency. Then exactly
one authorized complete rerun passed 79 tests with 3 existing intentional skips, zero
failures (2.1 minutes). Mobile root-route body passed in 345ms; CLI failure did not
recur. No full-suite loop, extra skips or concurrency reduction.

Production audit used official `https://registry.npmjs.org/`, retries disabled and
30-second request timeout: `No known vulnerabilities found`, exit 0. Credential scan
covered all 25 final changed files against configured local credentials, provider-key/
JWT/private-key patterns, credential/invitation URLs, non-fictional email and machine/
hosted-project identifiers; zero findings. Bundle scan covered 24 browser files; no
server secret. These scans are bounded checks, not proof of absence of every secret.

Final formatting and diff checks passed. Four repaired fixture files also passed
zero-warning ESLint. All 30 LF-restored baseline files remain outside tracked/staged
changes; none is among those four fixture files. All 20 pre-existing Phase 9
code/contract fingerprints remain identical; only this report changed among original 21
paths. No dependency, lockfile, Prettier, `.gitattributes`, `next-env.d.ts`,
production-source or schema changes occurred during fixture repair. Local Git EOL
setting produces no committed diff. Delivery requires final exact-path staging review,
commit/remote-head verification and one draft PR against main; never merge or deploy.

Independent Impeccable review requested disabled final suspension confirmation for known
open work and thinner inherited rules. Both fixes were rebuilt, tested and recaptured;
reviewer scored both resolved, disposition `ship` scoped to those fixes. Source-only
documenter reconciliation found existing DESIGN.md covers extension; no design-system or
sidecar change. Settings, employees and invitations retain roster context through inline
forms, factual blockers, review links and focus/status feedback.

Earlier development failures were repaired, not counted as passing gates: read variable
scope; optional invitation-code collision; strict TypeScript optional/ref types; React
ref lint rule; test-only v2 manifest lookup; historical break fixture insertion order. A
sandboxed full unit run could not reach local CLI state; approved final run passed all
926 tests.

## Privacy and non-goals

Final change scope: 25 files. Original 21 Phase 9 paths plus four authorized synthetic
fixture repairs; no other baseline source changes.

```text
PHASE_9_STATUS.md
PRODUCT.md
README.md
apps/web/e2e/employee-corrections.spec.mts
apps/web/e2e/employee-live-breaks.spec.mts
apps/web/e2e/employee-time-clock.spec.mts
apps/web/e2e/manager-corrections.spec.mts
apps/web/e2e/manager-team.spec.mts
apps/web/e2e/phase8-fixtures.mts
apps/web/src/app/manager/page.tsx
apps/web/src/app/manager/team/page.tsx
apps/web/src/components/team-panel.tsx
apps/web/src/components/ui/button.tsx
apps/web/src/lib/team/actions.ts
apps/web/src/lib/team/model.test.ts
apps/web/src/lib/team/model.ts
apps/web/src/lib/team/operations.ts
apps/web/src/lib/team/server.test.ts
apps/web/src/lib/team/server.ts
packages/database/MANAGER_TEAM.md
packages/database/README.md
packages/database/src/database.types.ts
supabase/migrations/20260904104342_manager_team_administration.sql
supabase/tests/README.md
supabase/tests/manager_team_administration.test.sql
```

Audit actions: `employee_profile.updated`, `employee_membership.suspended`,
`employee_membership.reactivated`, `organization.settings_updated`,
`worksite.settings_updated`. JSON records changed field names or statuses only, never
name/code/email text, notes, request payloads, Auth/session IDs or credentials. Existing
actor attribution remains. Real changes, audit(s) and one operation result commit
atomically; retries, no-ops and blockers append no audit. Guards are not a claim of
administrator-proof or tamper-proof history.

Pilot bounds: first 100 employees and 100 recent invitations; no full-history
pagination. Browser uncertain-operation cache is in-memory and ends on reload/tab close.
No new dependencies, signup, production email, resend, Auth deletion, MFA, multiple
organizations or worksites, role changes, transfers, employee/history deletion, payroll,
wage/overtime/ statutory-rest/declaration rules, provider mappings, billing, schedules,
native apps or infrastructure deployment. No real customer or employee data used.
