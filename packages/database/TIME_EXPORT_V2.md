# Time export v2 contract

`cloxa.time-export.v2` captures manager-confirmed factual versions with explicit gross,
unpaid-break and net-worked durations. It adds separate tables and RPCs; v1 snapshots,
serializers, hashes and download routes are unchanged. Files make no payroll,
statutory-rest, legal or social-secretariat acceptance claim.

## Selection and bounds

`brussels-start-date.v1` retains inclusive input dates spanning 1–31 Brussels calendar
days, ending no later than today in Brussels. Selection uses the half-open UTC window
between local start midnight and midnight after the final date. Closed, finite, positive
entries belong to the period containing their start, including the whole interval of
overnight work. Inactive employees retain historical facts.

Open entries overlapping the window, pending shift corrections targeting selected
entries or proposing overlapping intervals, and pending break corrections for selected
entries block creation. Other blockers: `no_records`, `row_limit`, `artifact_too_large`.
Warnings retain `missing_employee_code` and `missing_display_name`; absent optional text
stays null.

The 10,000-entry and 10 MiB artifact ceilings remain. Before constructing record arrays,
the conservative v2 estimate is:

```text
8192 + sum(4096 + 2048 × effective_break_count
           + 6 × UTF8_octets(employee_code + display_name + worksite_name))
```

Null text contributes zero bytes. V2 increases per-row reserve because it repeats three
duration totals and embeds break objects in quoted CSV. This can reject fewer than
10,000 rows. Download serialization independently enforces actual UTF-8 bytes.

## Manifest and records

Manifest retains v1 identity, timezone, period, creation, count, selection-rule and
dataset-hash fields. `schema_version` is `cloxa.time-export.v2`.
`total_duration_microseconds` is replaced by three decimal integer strings:

- `total_gross_duration_microseconds`
- `total_unpaid_break_duration_microseconds`
- `total_net_worked_duration_microseconds`

Every record retains v1 fields except `duration_microseconds`, replaced by
`gross_duration_microseconds`, `unpaid_break_duration_microseconds`, and
`net_worked_duration_microseconds`. Each adds integer `effective_break_count` and
ordered `breaks` array. Break objects contain exactly:

| Key                              | Meaning                                                           |
| -------------------------------- | ----------------------------------------------------------------- |
| `logical_break_id`               | Stable original live-break UUID or server-owned missed-break UUID |
| `version`                        | Effective positive integer version                                |
| `revision_id`                    | Applied revision UUID; null for an uncorrected live fact          |
| `started_at_utc`, `ended_at_utc` | Canonical UTC interval, six fractional digits                     |
| `origin`                         | `live` or `approved_missed_break`                                 |

Only effective non-removed breaks enter exported arrays. Original live closed facts have
version 2; first approved missed break has version 1. Subsequent revisions increment
their logical break version. Tombstones remain in correction history.

Gross equals exact UTC end minus start. Unpaid equals the exact sum of effective break
intervals. Net equals gross minus unpaid and may be zero. PostgreSQL numeric integers
and JavaScript BigInt preserve microseconds. JSON boundaries use decimal strings, never
floating-point duration numbers. UTC and Brussels formats, including historical
second-level offsets, retain the v1 contract.

Records order by membership UUID, UTC start, UTC end, and source entry UUID, then
receive immutable ordinals. Membership UUID remains an internal ordering key as in v1.
Breaks order by UTC start, then logical UUID. Each interval is half-open: touching is
allowed, overlap is rejected. Server parsers verify all durations, counts, exact keys,
dates, versions, nullability, identity, containment and ordering.

## Canonical bytes and reconciliation

Dataset SHA-256 hashes UTF-8 PostgreSQL `jsonb::text` of `{manifest, records}` with
`dataset_sha256` omitted from manifest. ASCII keys sort by byte length then byte order,
using colon-space and comma-space separators. Array order is significant. Server
independently rebuilds and checks this hash before download.

JSON artifact uses that same canonical object ordering, includes the hash, has no BOM
and ends in one LF. CSV has one shift per row, UTF-8 BOM, comma delimiters, CRLF endings
including the final row, and quotes every field, doubling quotes. CSV headers are
manifest keys in ASCII alphabetical order, followed by record keys in ASCII alphabetical
order excluding the repeated `worksite_id`. Nulls become empty quoted cells. The
`breaks` cell contains canonical JSON of the ordered array, with the same spacing and
key ordering as the JSON artifact. Parse CSV quoting first, then JSON-decode this cell
for exact break reconciliation.

Employee code/name and worksite text use the unchanged v1 spreadsheet neutralizer:
prefix one apostrophe for a leading whitespace, Unicode control/format character, `=`,
`+`, `-`, or `@`. JSON retains original text. Never strip apostrophes generally.
`X-Cloxa-Artifact-SHA256` covers actual artifact bytes, including BOM/newlines.

## Storage, authorization and operations

- `public.time_exports_v2`: tenant-bound, read-only metadata and manifest.
- `private.time_export_v2_snapshots`: one complete ordered record array per export.
- `private.time_export_v2_operations`: global UUID, actor, exact intent hash and durable
  JSON result.
- `private.time_export_v2_selection`: single-statement snapshot for bounds, blockers,
  names, versions and effective breaks.
- `private.time_export_v2`: authenticated implementation for preview/create/history/
  snapshot. Public wrappers: `preview_time_export_v2`, `create_time_export_v2`,
  `get_time_exports_v2`, `get_time_export_v2_snapshot`.

Every v2 RPC accepts and returns `request_id`. Creation additionally accepts explicit
confirmation. Its exact result keys are `request_id`, `result_code`, `did_create`,
`manifest`. `created` requires true plus a valid manifest. Each blocker requires false
plus null manifest. Replays return persisted JSON unchanged. UUID reuse by another actor
or payload fails. Blocked creation writes only its private result.

All operations require current authenticated manager authority, verified/live Auth
user/session, one active membership, active pilot/beta organization, and sole worksite.
Creation locks caller Auth/session, global UUID namespace `17073`, tenant employees in
shared `17031` ordered by hash then UUID, memberships, organization, worksite, entries,
live breaks, shift requests, then break requests. Every mutable workflow serializes on
the employee key before parent locks. Authorization is checked after waits and after
snapshot selection. Revisions append under the parent lock.

Metadata, snapshot, hash, durable result and minimal `time_export.created` audit commit
atomically. Audit uses v2 schema and totals, excluding reasons and notes. Public RLS
permits same-organization managers; private tables have no application read/write
grants. UPDATE/DELETE/TRUNCATE guards protect history against accidental owner
operations. Administrators able to disable triggers remain outside this boundary.

Downloads use current normal caller session through
`/manager/exports-v2/[exportId]/[format]`, with private/no-store, attachment, nosniff
and hash headers. No service secret, public URL, Storage object or persistent export
file is used. Later revisions cannot alter captured rows. Retention/deletion tooling,
full history pagination, delivery integrations and scheduled exports remain outside this
phase.

## Historical correction workflow

`public.break_correction_requests` stores immutable tenant/employee/worksite/parent
binding, server logical UUID for missed claims, kind, parent version and interval,
original effective snapshot, proposal, reason and submission UUID. Decisions change only
terminal status metadata. `public.time_break_revisions` appends facts, including
tombstones, with unique `(logical_break_id, version)` and tenant-consistent request and
applied-revision foreign keys. Insertion validates exact predecessor snapshot, parent
version, proposal and containment. Original `public.time_breaks` is unchanged.

`private.effective_time_breaks(entry_id)` is the sole latest-state resolver. It returns
all logical identities, including tombstones. `private.time_entry_breaks` projects
non-removed results for existing clock and shift-correction readers.

RPCs `change_break_correction`, `decide_break_correction`, `get_break_corrections` use
private implementations of the same names. Employee intent is `missed_break`,
`adjustment`, `removal`, or `withdraw`; manager decision is `approve` or `reject`. The
request ledger is `private.break_correction_request_operations` (namespace `17071`);
decision ledger is `private.break_correction_decision_operations` (`17072`). Both
precede shared employee serialization `17031` and parent locks.

Exact mutation result keys: `request_id`, `result_code`, `did_transition`,
`correction_request_id`, `request_status`, `applied_revision_id`. Codes: `submitted`,
`withdrawn`, `approved`, `rejected`, `already_terminal`, `closed_shift_required`,
`stale_request`, `pending_time_correction`, `pending_break_correction`,
`invalid_interval`, `overlap`, `unchanged`, `unavailable`. Submission blockers have null
request facts. Decision blockers retain pending status. Rejection can close stale claims
without changing facts. Confirmed results retire browser UUIDs and refresh; uncertain
results retain UUIDs for the same intent payload.

One pending break request per shift is enforced by submission under the parent lock; a
unique pending logical-target index adds database defense. Shift submissions reject
pending break requests with existing `correction_pending_conflict`; shift approval
returns existing durable `break_conflict`. Both use effective containment. Version
snapshots reject drift and ABA even if timestamps are restored.

Dutch wall-time inputs use existing `private.resolve_brussels_local`: DST gaps fail;
ambiguous fall-back values require `earlier` or `later`. No browser Date conversion
chooses an occurrence. Removal supplies no interval.

Audit actions: `break_correction_request.submitted`, `.withdrawn`, `.approved`,
`.rejected`, and `time_break_revision.added`, `.adjusted`, `.removed`. Request audits
contain status only; revision audits contain factual predecessor/new interval, logical
identity, version, parent reference and origin. Reasons/notes are excluded.

New v1 exports fail closed whenever any selected entry has ever had a live break or
revision, including a fully removed history. V1 artifacts are never regenerated as v2.
