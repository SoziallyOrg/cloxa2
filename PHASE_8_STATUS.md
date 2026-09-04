# Phase 8 verification report

Status: implementation and local verification complete. Dependency audit remains an
external registry blocker after pnpm exhausted all retries. Branch remains unmerged and
undeployed; draft review is required.

Branch: `feat/break-corrections-export-v2`. Required baseline, local `main`, and
`origin/main` all resolved to `2220c01ab63c082e5617541313a2793203ebdda6` before work.
Work used synthetic local data only.

## Delivered behavior

Employees can request a missed historical unpaid break, adjust one current effective
break, remove one through a retained tombstone, and withdraw their own pending request.
Managers compare submitted and current snapshots, then explicitly approve or reject.
Approval appends exactly one immutable revision. Original live facts and all prior
revisions remain unchanged.

`private.effective_time_breaks(uuid)` is the authoritative latest-state resolver. It
returns live facts, revisions, and tombstones. Existing readers project its effective
non-removed intervals. Time-entry and break-correction workflows share employee
serialization and reject pending cross-workflow claims. Parent version plus complete
effective snapshots detect stale and ABA changes.

Dutch UI adds `/employee/break-corrections`, `/manager/break-corrections`, and
`/manager/exports-v2`, with navigation from existing role pages. Brussels wall-time
claims preserve six fractional digits and require explicit earlier/later choice for
ambiguous fall-back times. Feedback receives focus, pending fields disable, full
intervals wrap at 320px, and changing an export date clears its prior preview and
confirmation.

## Exact database surface

New public tables:

- `public.break_correction_requests`
- `public.time_break_revisions`
- `public.time_exports_v2`

New private tables:

- `private.break_correction_request_operations`
- `private.break_correction_decision_operations`
- `private.time_export_v2_snapshots`
- `private.time_export_v2_operations`

New private functions:

- `private.effective_time_breaks(uuid)`
- `private.guard_break_request_history()`
- `private.guard_break_revision()`
- `private.change_break_correction(uuid,text,uuid,uuid,integer,integer,text,text,text,text,text)`
- `private.decide_break_correction(uuid,uuid,text,text,boolean)`
- `private.get_break_corrections(uuid)`
- `private.time_export_v2_selection(uuid,uuid,timestamptz,timestamptz)`
- `private.time_export_v2(uuid,text,text,text,boolean,uuid)`

Existing private functions replaced with break-aware definitions:

- `private.time_entry_breaks(uuid)`
- `private.guard_time_entry_history()`
- `private.submit_employee_correction_request(uuid,text,uuid,text,text,text,text,text)`
- `private.decide_correction_request(uuid,uuid,text,text)`
- `private.preview_time_export(text,text)`
- `private.create_time_export(uuid,text,text,boolean)`

New public RPCs:

- `change_break_correction(uuid,text,uuid,uuid,integer,integer,text,text,text,text,text)`
- `decide_break_correction(uuid,uuid,text,text,boolean)`
- `get_break_corrections(uuid)`
- `preview_time_export_v2(uuid,text,text)`
- `create_time_export_v2(uuid,text,text,boolean)`
- `get_time_export_v2_snapshot(uuid,uuid)`
- `get_time_exports_v2(uuid)`

Break-correction results contain exactly `request_id`, `result_code`, `did_transition`,
`correction_request_id`, `request_status`, and `applied_revision_id`. Codes are
`submitted`, `withdrawn`, `approved`, `rejected`, `already_terminal`,
`closed_shift_required`, `stale_request`, `pending_time_correction`,
`pending_break_correction`, `invalid_interval`, `overlap`, `unchanged`, and
`unavailable`.

V2 creation results contain exactly `request_id`, `result_code`, `did_create`, and
`manifest`. Codes are `created`, `open_entry`, `pending_correction`,
`pending_break_correction`, `no_records`, `row_limit`, and `artifact_too_large`.

Audit actions are `break_correction_request.submitted`,
`break_correction_request.withdrawn`, `break_correction_request.approved`,
`break_correction_request.rejected`, `time_break_revision.added`,
`time_break_revision.adjusted`, `time_break_revision.removed`, and
`time_export.created`. Audit payloads omit employee reasons and manager notes.

Operation lock namespaces are `17071` for employee break requests, `17072` for manager
decisions, and `17073` for v2 export creation. All join existing employee namespace
`17031` before parent fact locks. Authorization and session state are rechecked after
waits.

## Time export v2 contract

Schema identifier is `cloxa.time-export.v2`; selection rule remains
`brussels-start-date.v1`. Inclusive Brussels input dates cover 1–31 days. Selection is
the half-open UTC range from local start midnight through midnight after final date and
assigns the complete closed entry by Brussels start date. Open entries and pending time
or break corrections block creation.

Each ordered row captures source entry identity/version, employee and worksite fields,
UTC and Brussels timestamps, exact decimal-string gross/unpaid/net microseconds, break
count, factual origin, and ordered effective break objects. Each break captures logical
identity, effective version, nullable revision identity, UTC interval, and `live` or
`approved_missed_break` origin. Half-open intervals may touch; overlap is rejected.

Dataset SHA-256 covers PostgreSQL-compatible canonical JSON of manifest without hash
plus records. JSON uses canonical key order and spacing, UTF-8 without BOM, and final
LF. CSV uses one shift per row, UTF-8 BOM, quoted comma fields, CRLF, sorted manifest
and record keys, spreadsheet-cell neutralization, and canonical nested-break JSON.
Download serialization verifies dataset hash and enforces 10 MiB. Creation caps 10,000
rows and uses documented conservative v2 size estimate. Full contract:
`packages/database/TIME_EXPORT_V2.md`.

## V1 preservation evidence

Migration leaves v1 snapshot tables, serializer, public signatures, stored rows, and
download route unchanged. pgTAP verifies pre-existing manifest/hash values and fixed v1
artifact inputs. Existing v1 golden serializer tests pass. Production browser coverage
captures original v1 JSON bytes before Phase 8 revisions, proves both original v1 JSON
and snapshot bytes remain identical afterward, and confirms new v1 creation returns
`break_data_requires_v2` even after effective removal.

## Final sequential verification

- Clean local Supabase reset: passed.
- Complete pgTAP: 10 files, 1,255 assertions passed; 203 Phase 8 assertions included.
- Database lint: passed; public/private schemas report no errors.
- Generated database-type freshness: passed.
- Prettier and `git diff --check`: passed.
- ESLint: passed with zero warnings.
- TypeScript: all three workspace projects passed.
- Unit/integration: 42 files, 783 tests passed; zero skipped.
- Production build: passed; 20 application routes generated.
- Complete production Playwright: 69 passed, 3 expected project-specific skips, zero
  failures. Phase 8 contributes six passing desktop/mobile runs.
- Production dependency audit: external blocker. `pnpm audit --prod --audit-level high`
  retried registry bulk-advisory request three times, then exited 1 with
  `TimeoutError: The operation was aborted due to timeout`. Dependencies were not
  changed and no vulnerability result is available.
- Credential scan: passed across 41 changed files; no environment/key files, configured
  secret values, or credential patterns found.
- Browser-bundle scan: passed across 22 production browser bundles; no server secret
  found.

Impeccable review found stale export-preview confirmation and clipped native-select
interval context. Both were fixed and covered by passing desktop/mobile journeys.
Follow-up reviewer execution hit its separate agent usage limit; regenerated captures
and complete production browser suite provide final local evidence.

`apps/web/next-env.d.ts` was restored byte-for-byte from baseline after production
build. Dependency files are unchanged. No secret, environment file, export artifact,
real personal data, merge, deployment, or VPS access is part of this phase.

## Remaining limits

- One organization and one worksite remain pilot assumptions; no worksite-management UI
  exists.
- Recent correction reads cap closed entries at 20 and terminal requests at 50; export
  history caps manifests at 20. Full pagination remains future work.
- No retention/deletion workflow, scheduled or emailed exports, provider delivery,
  PDF/XLSX, automatic breaks, statutory-rest calculation, payroll/declaration logic,
  realtime updates, geolocation, offline support, or native app exists.
- Download events are not audited. Creation is audited once with factual summary.
- Database owners who disable triggers remain outside application-history guarantees.
- V2 conservative size estimate can reject fewer than 10,000 rows; actual download bytes
  are independently capped at 10 MiB.
- Production dependency vulnerability status remains unknown until npm registry audit
  endpoint responds successfully.
