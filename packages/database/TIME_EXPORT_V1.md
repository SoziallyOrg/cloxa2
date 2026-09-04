# Time export v1 contract

`cloxa.time-export.v1` describes manager-confirmed factual snapshots, not payroll,
declarations, or social-secretariat delivery. Confirmation approves the versions
selected by the database for this export; preview rows are advisory, never submitted as
authority. A later correction requires another export and cannot rewrite earlier
snapshots.

## Selection and bounds

`brussels-start-date.v1` accepts inclusive `YYYY-MM-DD` dates, 1–31 calendar days,
ending no later than the database's current Brussels date. Start midnight and midnight
after the end date convert through `Europe/Brussels` to a half-open UTC interval. Only
current-tenant, sole-worksite, finite, closed, strictly ordered factual entries whose
Brussels start date belongs to that period enter the snapshot. Entire overnight
intervals stay with their start date; adjacent periods cannot duplicate those entries.
An employee's later inactivity does not remove historical factual entries from
selection.

Open intervals overlapping the UTC window, pending corrections targeting selected facts,
and pending adjustment/missed-entry proposals overlapping the window block creation.
Empty selection, invalid/future/overlong periods, more than 10,000 rows, or size bound
also block. Rejected and withdrawn proposals contribute no facts. Approved adjustments
retain `clock` origin; approved missing intervals use `approved_missed_entry` origin.

The conservative database bound is
`8192 + sum(2048 + 6 × UTF8_octets(code + name + worksite_name)) <= 10485760`, treating
absent optional text as empty for this calculation. It bounds escape expansion and
repeated manifest fields before materializing rows. Consequently, the size bound can
reject fewer than 10,000 rows. Route serialization also checks actual UTF-8 bytes
against 10 MiB. No queue, Storage, public URL, or persistent artifact file exists.
Transient in-memory serialization is bounded by these limits.

## Manifest

Every field is required. Names below are JSON keys and CSV headers.

| Field                         | Meaning / type                                       |
| ----------------------------- | ---------------------------------------------------- |
| `schema_version`              | Literal `cloxa.time-export.v1`                       |
| `export_id`                   | Fixed export UUID                                    |
| `organization_id`             | Tenant UUID                                          |
| `worksite_id`                 | Sole pilot worksite UUID                             |
| `timezone`                    | Literal `Europe/Brussels`                            |
| `period_start_local`          | Inclusive first Brussels date, `YYYY-MM-DD`          |
| `period_end_local`            | Inclusive last Brussels date, `YYYY-MM-DD`           |
| `created_at_utc`              | Database clock at creation, UTC format below         |
| `record_count`                | Integer, 1–10,000                                    |
| `employee_count`              | Distinct source membership count, 1–record count     |
| `total_duration_microseconds` | Positive exact base-10 integer string                |
| `dataset_sha256`              | Lowercase 64-character hexadecimal canonical SHA-256 |
| `selection_rule`              | Literal `brussels-start-date.v1`                     |

## Ordered records

| Field                                       | Meaning / type                                          |
| ------------------------------------------- | ------------------------------------------------------- |
| `row_ordinal`                               | Stable integer, starting at 1 without gaps              |
| `source_time_entry_id`                      | Factual entry UUID, not Auth/session identity           |
| `source_time_entry_version`                 | Captured positive factual version integer               |
| `employee_code`                             | Captured optional code, string or explicit null         |
| `employee_display_name`                     | Captured optional display name, string or explicit null |
| `worksite_id`                               | Same UUID as manifest                                   |
| `worksite_name`                             | Captured worksite name                                  |
| `started_at_utc` / `ended_at_utc`           | Complete interval, canonical UTC strings                |
| `started_at_brussels` / `ended_at_brussels` | Same instants, canonical Brussels strings               |
| `duration_microseconds`                     | Exact positive elapsed integer string                   |
| `factual_origin`                            | `clock` or `approved_missed_entry`                      |
| `last_correction_request_id`                | Last applied correction UUID or explicit null           |

UTC uses `YYYY-MM-DDTHH:mm:ss.ffffffZ`. Brussels uses
`YYYY-MM-DDTHH:mm:ss.ffffff±HH:mm`; historical offsets containing nonzero seconds append
`:ss` (for example pre-1892 Brussels `+00:17:30`). Spring and autumn transitions retain
their actual offsets. Elapsed duration is UTC subtraction, not subtraction of displayed
wall-clock times. PostgreSQL numeric integers and JavaScript BigInt preserve all six
fractional digits. JSON never emits durations as floating-point numbers.

Rows exclude email, Auth user/session IDs, correction reasons, manager notes,
invitations, operation identifiers, tokens, audit payloads, wages/rates, and payroll
calculations. Missing optional names/codes trigger preview warnings; no substitute
identifier is invented.

## Canonical ordering and hash

Creation assigns ordinals by source membership UUID, UTC start, UTC end, then entry
UUID. Source membership UUID is an internal sort key only; it is not exported. Stored
ordinals govern all later downloads, independent of planner order or changed profile
text.

Canonical input is one object containing `manifest` (all manifest fields except
`dataset_sha256`) and `records` (ordered full row objects). Canonical bytes are UTF-8
PostgreSQL `jsonb::text`, with no BOM or terminal newline. All keys are fixed ASCII:
sort object keys by byte length, then byte order; use `: ` and `, ` separators. Arrays
retain order. Strings follow JSON escaping; counts/versions/ordinals are bounded
integers, durations strings. SHA-256 covers these bytes, not either download artifact.
The server independently reconstructs this representation and denies mismatched hashes.

JSON artifact is compact `{ "manifest": ..., "records": ... }` without formatting spaces
(shown here only for readability), stable property order matching the field tables
above, explicit nulls, no BOM, and one final LF. CSV has UTF-8 BOM, comma delimiter,
CRLF record endings including final CRLF, and quotes every field, doubling embedded
double quotes. Manifest fields repeat on every CSV row; `worksite_id` appears once. Null
optional text/reference becomes an empty quoted CSV cell; JSON preserves null.

Before CSV quoting, user-controlled code/name/worksite text receives one ASCII
apostrophe if its first Unicode code point matches ECMAScript `\s`, Unicode `Cc`
(control), Unicode `Cf` (format), or `=`, `+`, `-`, `@`. This deliberately protects even
harmless leading whitespace/control text and formulas hidden behind it. Other text,
including commas, semicolons, quotes, embedded CR/LF, accents, and long strings, remains
unchanged. JSON retains original strings. Reconcile text using this deterministic
transform, not by stripping apostrophes indiscriminately. Spreadsheet software can alter
data on later edits/re-saves; this is protection for generated files, not a guarantee
for rewritten files.

Repeated downloads of a snapshot are byte-identical per format.
`X-Cloxa-Artifact-SHA256` hashes actual returned bytes, including BOM/newlines. A file's
own byte hash is never embedded inside those bytes. Attachment filenames contain only
controlled ASCII product, period, and export-ID components.

## Authorization, audit, and limits of protection

Preview, creation, history, and download independently require effective authenticated
role, verified/non-banned/non-deleted Auth user, matching live non-expired session,
exactly one active membership, manager role, active research pilot or paid beta tenant,
same organization, and exactly one worksite. Download uses normal caller Supabase
session through an authenticated Route Handler, never a service secret or signed/public
URL. Headers include content type, attachment, private/no-store, and nosniff.

Creation locks Auth/session, global operation key (`17051`), tenant employee keys in
existing namespace `17031` ordered by hash then UUID, memberships, organization,
worksite, facts, then correction rows. Authorization is rechecked after waits. Rows,
counts, totals, identity text, and blockers come from one statement snapshot. This also
avoids mixed reads if a membership is first inserted after lock enumeration. Manager
decisions and clock-out either finish first or leave pending/open blockers visible.

The global creation UUID binds manager membership and SHA-256 of exact supplied dates,
authenticated user, and confirmation. Identical retries replay original success or safe
blocker; changed actor/payload fails closed. Different UUIDs may create separate
historical snapshots. Rows, metadata, canonical hash, operation outcome, and one
`time_export.created` audit commit atomically. Creation audit contains only manifest
summary fields. Downloads are not audited. A future request audit would need its own
idempotency contract and must not claim completed delivery.

Public metadata has tenant RLS and read-only grants. Private rows/operations have RLS,
no browser policies, and no direct application grants. UPDATE/DELETE/TRUNCATE guards
protect all three structures. Database owners can alter triggers or grants; owner
tampering is outside this application guarantee. Snapshot protection is not a marketing
claim of tamper-proof storage or legal/payroll suitability. Retention, controlled
deletion, and export redaction remain future work; no social-secretariat delivery is
implemented.

## Compatibility note: live breaks

From Phase 7, new previews and creations return `break_data_requires_v2` when any
selected time entry has break facts. Creation persists and replays this safe blocker
without export metadata, snapshot rows, audit, or artifact. Break-aware exports require
a separately reviewed v2. Existing v1 snapshots retain exactly their original fields,
meaning, bytes, hashes, and download behavior; no v1 duration silently subtracts breaks.
