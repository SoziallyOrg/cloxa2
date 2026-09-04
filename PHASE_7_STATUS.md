# Phase 7 verification report

Branch: `feat/employee-live-breaks`. Baseline: `9f4e9c1`, containing required Phase 6
commit `ead22cb07b080deb1433e7c41daf17db44e694d5`. Working tree was clean before
implementation. One new migration; merged migrations remain unchanged.

## Implemented behavior

Tenant-bound `public.time_breaks` records server-controlled unpaid live intervals.
Composite foreign keys bind tenant, employee, worksite, and parent entry. Open rows
start at version 1; closing increments to version 2. Identity/start/history are guarded
against rewrite, and closed updates, deletion, and truncation fail through normal roles.
Employees read own breaks; authorized managers read same-tenant workflow facts. Browser
and service-role application paths have no direct write grants. Database owners can
disable guards; this is not tamper-proof storage.

`start_break` and `end_break` accept only operation UUIDs. Protected operations validate
verified/live Auth and session, exactly one active employee membership, pilot/beta
tenant, and one worksite. Auth locks precede employee advisory namespace 17031,
membership, organization, worksite, entry, and break locks. Private namespace 17061
binds break UUIDs to actor and intent. Immutable outcomes replay identical retries,
reject altered reuse, and commit atomically with facts and minimal `time_break.started`
/ `time_break.ended` audits. Audit payloads contain factual identifiers, timestamps,
status, and version; no credentials, Auth/session IDs, email, reasons, or notes.

Clock-out persists `open_break` refusal without closing a break. Correction submission
and approval lock existing breaks and enforce containment. Durable `break_conflict`
leaves approval pending without factual/approval audit or break edits. New v1 export
preview/creation returns `break_data_requires_v2` for selected break-bearing facts;
blocked creation writes only its private retry outcome, with zero export metadata,
snapshot, audit, or artifact. Existing v1 serializer, fields, canonical hash rules, and
download behavior remain unchanged.

Dutch UI provides live state, pending controls, clock-out explanation, feedback focus,
ordered Brussels timestamps retaining UTC machine facts, and BigInt microsecond
gross/completed-break/net totals. Open facts receive no invented end. Correction context
and manager review display existing breaks without editing controls. Reloaded Next.js
form metadata is ignored; business payload remains strict and RPC receives only UUID.

## Verified evidence

- Clean local Supabase reset applied every migration.
- pgTAP: 9 files, 1,047 assertions passed, including 99 new break assertions.
- Database lint: public/private passed without findings.
- Generated database types and freshness check passed.
- Formatting, diff whitespace, ESLint, and all TypeScript checks passed.
- Vitest: 36 files, 607 tests passed; zero skipped.
- Production build passed; 20 browser bundle files passed secret checks.
- Complete production Playwright: 61 passed, 3 existing project-specific skips (64
  total), including all 10 new break test runs. Final complete run follows reviewer
  fixes.
- Production dependency audit was run and exhausted registry retries with exit 1: "The
  operation was aborted due to timeout". Independent Node and IPv4 curl requests to the
  official advisory endpoint also timed out. Current advisory status remains unverified;
  this gate needs rerun when registry access recovers. No ignore-errors flag, dependency
  change, or vulnerability-free claim was used.
- Scoped credential scan: 38 changed/new files, zero findings.
- Final browser-bundle scan: 20 files, no server secret.
- Impeccable detector: no findings. Fresh finish review identified three presentation
  issues; final verdict scored all three resolved after recapture at desktop/320px.
  Verdict scope is those fixes, not blanket production-readiness approval.

Concurrency tests exercise simultaneous browser tabs, eight identical starts across two
sessions, repeated end retries, mixed end/clock-out and start/clock-out outcomes, and
manager approval concurrent with a new live break while preserving prior break rows.
Authorization expiry during employee-lock waits produces no fact or outcome. Database
injection tests verify rollback of fact, audit, and operation together. Export coverage
compares original v1 CSV/JSON bytes and hashes before and after new breaks and checks
zero-output blocked creation and durable retries.

## Local runtime recovery

Docker Linux engine recovered after WSL became available and stale zero-byte socket
directories were moved to sibling backups. No host service configuration changed.
Backups remain at Docker/run.phase7-backup, Docker/run.phase7-retry-backup, and
docker-secrets-engine.phase7-backup beneath local app data. Test reset touched only
local synthetic database state. No hosted Supabase, real employee data, deployment,
merge, or paid resource was used.

## Limitations

Only live unpaid factual intervals are supported. Historical/manual breaks, break
corrections, automatic breaks, statutory-rest rules, payroll, export v2, scheduling,
geolocation, and native apps remain unimplemented. New v1 exports deliberately block
break-bearing facts until separately reviewed v2. No compliance or production-readiness
claim is made. Local concurrency tests demonstrate covered serial outcomes, not an
exhaustive proof across all possible schedules.

## Changed implementation files

- `DESIGN.md`
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
- `supabase/migrations/20260903230921_employee_live_breaks.sql`
- `supabase/tests/README.md`
- `supabase/tests/employee_live_breaks.test.sql`

- `packages/database/src/database.types.ts`
- `apps/web/next-env.d.ts` (production-generated route type paths)
- `PHASE_7_STATUS.md`

- `.impeccable/design.json` (existing component previews updated)
